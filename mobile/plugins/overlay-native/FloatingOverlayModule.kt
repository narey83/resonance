// <copyright file="FloatingOverlayModule.kt" company="John Narey">
//   SPDX-FileCopyrightText: John Narey
//   SPDX-License-Identifier: AGPL-3.0-only
//   Part of Resonance, a Soulseek client based on slskd.
// </copyright>
//
// Draws a Messenger-style floating music controller ON TOP OF other apps and the
// home screen using a SYSTEM_ALERT_WINDOW overlay. The view is added directly to
// the WindowManager from the module (no Service needed) — react-native-track-player
// keeps the process alive with its media foreground service while audio plays, so
// the overlay survives backgrounding. Transport taps are emitted back to JS, which
// routes them to TrackPlayer; JS pushes metadata/state down via update().

package com.resonance.mobile

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlin.math.abs
import kotlin.math.sqrt

class FloatingOverlayModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "FloatingOverlay"

  private var windowManager: WindowManager? = null
  private var overlayView: LinearLayout? = null
  private var artView: ImageView? = null
  private var ringView: RingView? = null
  private var dismissView: View? = null
  private var controlsContainer: LinearLayout? = null
  private var playPauseButton: ImageButton? = null
  private var layoutParams: WindowManager.LayoutParams? = null
  private var isPlaying = false
  private var controlsShown = false
  private val handler = Handler(Looper.getMainLooper())
  private var longPress: Runnable? = null

  private fun dp(value: Int): Int =
    TypedValue.applyDimension(
      TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), reactContext.resources.displayMetrics,
    ).toInt()

  private fun canDraw(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(reactContext)

  private fun emitMap(map: WritableMap) {
    runCatching {
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("FloatingOverlayAction", map)
    }
  }

  private fun emit(action: String) {
    emitMap(Arguments.createMap().apply { putString("action", action) })
  }

  // ── JS API ────────────────────────────────────────────────────────────────

  @ReactMethod
  fun hasPermission(promise: Promise) {
    promise.resolve(canDraw())
  }

  @ReactMethod
  fun requestPermission() {
    if (canDraw()) return
    val intent = Intent(
      Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
      Uri.parse("package:" + reactContext.packageName),
    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactContext.startActivity(intent)
  }

  @ReactMethod
  fun show(state: ReadableMap) {
    if (!canDraw()) return
    runOnUi {
      if (overlayView == null) createOverlay()
      applyState(state)
    }
  }

  // Position ring, 0..1, in the app's current accent colour. Separate from update() because it
  // ticks with playback, so it carries no metadata and does no bitmap work.
  @ReactMethod
  fun setProgress(progress: Double, color: String?) {
    runOnUi {
      ringView?.let { ring ->
        color?.let { ring.setBarColor(it) }
        ring.progress = progress.toFloat()
      }
    }
  }

  @ReactMethod
  fun update(state: ReadableMap) {
    if (overlayView == null) return
    runOnUi { applyState(state) }
  }

  // Cheaply hide/reveal without destroying the view, so the artwork bitmap and
  // position survive (used while the in-app full player is open).
  @ReactMethod
  fun setVisible(visible: Boolean) {
    runOnUi { overlayView?.visibility = if (visible) View.VISIBLE else View.GONE }
  }

  @ReactMethod
  fun hide() {
    runOnUi {
      hideDismissTarget()
      longPress?.let { handler.removeCallbacks(it) }
      overlayView?.let { v -> runCatching { windowManager?.removeView(v) } }
      overlayView = null
      artView = null
      ringView = null
      controlsContainer = null
      playPauseButton = null
      layoutParams = null
      controlsShown = false
    }
  }

  // ── View construction ───────────────────────────────────────────────────────

  private fun createOverlay() {
    val wm = reactContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    windowManager = wm

    val bubble = dp(74)

    // Collapsed by default: the root wraps just the circular art disc (a bubble).
    // Holding expands the controls and swaps in the dark pill background.
    val root = LinearLayout(reactContext).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(5), dp(5), dp(5), dp(5))
    }

    // Album-art disc — drag handle; tap opens the app, long-press reveals controls
    // (mirrors the in-app bubble).
    val art = ImageView(reactContext).apply {
      layoutParams = LinearLayout.LayoutParams(bubble, bubble)
      scaleType = ImageView.ScaleType.CENTER_CROP
      clipToOutline = true
      outlineProvider = object : ViewOutlineProvider() {
        override fun getOutline(v: View, outline: Outline) {
          outline.setOval(0, 0, v.width, v.height)
        }
      }
      setBackgroundColor(Color.parseColor("#333338"))
    }
    artView = art

    // Ring sits in its own view stacked over the art: the art clips itself to an oval
    // outline, which would shave the outer half of a stroke drawn inside it.
    val ring = RingView(reactContext, dp(7).toFloat())
    ringView = ring

    val artWrap = FrameLayout(reactContext).apply {
      layoutParams = LinearLayout.LayoutParams(bubble, bubble)
      addView(art, FrameLayout.LayoutParams(bubble, bubble))
      addView(ring, FrameLayout.LayoutParams(bubble, bubble))
    }
    attachDrag(artWrap)
    root.addView(artWrap)

    // Controls, hidden until the bubble is tapped.
    val controls = LinearLayout(reactContext).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      visibility = View.GONE
      setPadding(dp(4), 0, dp(2), 0)
    }
    controls.addView(controlButton(android.R.drawable.ic_media_previous) { emit("prev") })
    playPauseButton = controlButton(android.R.drawable.ic_media_play) { emit(if (isPlaying) "pause" else "play") }
    controls.addView(playPauseButton)
    controls.addView(controlButton(android.R.drawable.ic_media_next) { emit("next") })
    controlsContainer = controls
    root.addView(controls)

    overlayView = root

    val type =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = dp(12)
      y = reactContext.resources.displayMetrics.heightPixels / 2
    }
    layoutParams = params
    runCatching { wm.addView(root, params) }
  }

  private fun controlButton(icon: Int, onClick: () -> Unit): ImageButton =
    ImageButton(reactContext).apply {
      layoutParams = LinearLayout.LayoutParams(dp(44), dp(44))
      setImageResource(icon)
      setColorFilter(Color.WHITE)
      setBackgroundColor(Color.TRANSPARENT)
      scaleType = ImageView.ScaleType.CENTER_INSIDE
      setOnClickListener { onClick() }
    }

  private fun attachDrag(handle: View) {
    var startX = 0
    var startY = 0
    var touchX = 0f
    var touchY = 0f
    var longFired = false
    handle.setOnTouchListener { _, event ->
      val params = layoutParams ?: return@setOnTouchListener false
      when (event.action) {
        MotionEvent.ACTION_DOWN -> {
          startX = params.x; startY = params.y
          touchX = event.rawX; touchY = event.rawY
          longFired = false
          longPress?.let { handler.removeCallbacks(it) }
          longPress = Runnable { longFired = true; toggleControls() }.also { handler.postDelayed(it, 380) }
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val moved = abs(event.rawX - touchX) + abs(event.rawY - touchY)
          if (moved > dp(10)) {
            longPress?.let { handler.removeCallbacks(it) }
            showDismissTarget() // only while actually dragging, not on a tap
          }
          params.x = startX + (event.rawX - touchX).toInt()
          params.y = startY + (event.rawY - touchY).toInt()
          runCatching { windowManager?.updateViewLayout(overlayView, params) }
          // Grow the target as the bubble closes in, so the drop zone reads as live.
          dismissView?.scaleX = if (overDismiss(params)) 1.25f else 1f
          dismissView?.scaleY = dismissView?.scaleX ?: 1f
          true
        }
        MotionEvent.ACTION_UP -> {
          longPress?.let { handler.removeCallbacks(it) }
          val moved = abs(event.rawX - touchX) + abs(event.rawY - touchY)
          val dropped = overDismiss(params)
          hideDismissTarget()
          when {
            longFired      -> Unit                 // long-press already revealed controls
            moved < dp(10) -> openApp()             // tap → open the app / full player
            dropped        -> { emit("close"); hide() } // dropped on the X → stop and tear down
            else           -> snapToEdge(params)    // drag → snap to nearest edge
          }
          true
        }
        MotionEvent.ACTION_CANCEL -> {
          longPress?.let { handler.removeCallbacks(it) }
          hideDismissTarget()
          true
        }
        else -> false
      }
    }
  }

  // Expand/collapse the controls beside the bubble, swapping the pill background in
  // and out, then nudge back on-screen if the expanded pill would overflow an edge.
  private fun toggleControls() {
    val controls = controlsContainer ?: return
    val root = overlayView ?: return
    controlsShown = !controlsShown
    controls.visibility = if (controlsShown) View.VISIBLE else View.GONE
    root.background = if (controlsShown) pillBackground() else null
    root.post {
      val params = layoutParams ?: return@post
      val screenW = reactContext.resources.displayMetrics.widthPixels
      if (params.x + root.width > screenW - dp(8)) params.x = screenW - root.width - dp(8)
      if (params.x < dp(8)) params.x = dp(8)
      runCatching { windowManager?.updateViewLayout(root, params) }
    }
  }

  private fun pillBackground() = GradientDrawable().apply {
    cornerRadius = dp(34).toFloat()
    setColor(Color.parseColor("#EE161618"))
  }

  // ── Drag-to-dismiss target ──────────────────────────────────────────────────
  // A close target near the bottom of the screen, shown only while the bubble is being
  // dragged. Dropping the bubble on it emits "close", which stops playback and tears the
  // overlay down — the bubble's only exit, since it deliberately outlives the app.

  private fun dismissTargetSize() = dp(64)

  private fun dismissCenter(): Pair<Int, Int> {
    val metrics = reactContext.resources.displayMetrics
    return Pair(metrics.widthPixels / 2, metrics.heightPixels - dp(140))
  }

  private fun showDismissTarget() {
    if (dismissView != null) return
    val size = dismissTargetSize()
    val icon = ImageView(reactContext).apply {
      setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
      setColorFilter(Color.WHITE)
      scaleType = ImageView.ScaleType.CENTER_INSIDE
      setPadding(dp(16), dp(16), dp(16), dp(16))
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#CC1C1C20"))
      }
    }
    val (cx, cy) = dismissCenter()
    val params = WindowManager.LayoutParams(
      size,
      size,
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = cx - size / 2
      y = cy - size / 2
    }
    dismissView = icon
    runCatching { windowManager?.addView(icon, params) }
  }

  private fun hideDismissTarget() {
    dismissView?.let { v -> runCatching { windowManager?.removeView(v) } }
    dismissView = null
  }

  // True when the dragged bubble's centre is close enough to the target to drop on it.
  private fun overDismiss(params: WindowManager.LayoutParams): Boolean {
    val view = overlayView ?: return false
    val (cx, cy) = dismissCenter()
    val bubbleX = params.x + view.width / 2
    val bubbleY = params.y + view.height / 2
    val dx = (bubbleX - cx).toFloat()
    val dy = (bubbleY - cy).toFloat()
    return sqrt(dx * dx + dy * dy) < dismissTargetSize()
  }

  private fun openApp() {
    // Emit FIRST so JS starts opening the full player while the app is still in the
    // background — by the time the window is shown the player is already expanding,
    // so the user never sees the underlying screen (e.g. Library) flash first.
    // Also send the bubble's on-screen rect (dp) so the player morphs out of it.
    val density = reactContext.resources.displayMetrics.density
    val p = layoutParams
    val sizePx = (artView?.width ?: 0).takeIf { it > 0 } ?: dp(74)
    emitMap(Arguments.createMap().apply {
      putString("action", "open")
      if (p != null) {
        putDouble("x", (p.x + dp(5)) / density.toDouble())
        putDouble("y", (p.y + dp(5)) / density.toDouble())
        putDouble("size", sizePx / density.toDouble())
      }
    })
    reactContext.packageManager
      .getLaunchIntentForPackage(reactContext.packageName)
      ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
      ?.let { runCatching { reactContext.startActivity(it) } }
  }

  private fun snapToEdge(params: WindowManager.LayoutParams) {
    val screenW = reactContext.resources.displayMetrics.widthPixels
    val viewW = overlayView?.width ?: 0
    val center = params.x + viewW / 2
    params.x = if (center < screenW / 2) dp(12) else screenW - viewW - dp(12)
    runCatching { windowManager?.updateViewLayout(overlayView, params) }
  }

  private fun applyState(state: ReadableMap) {
    isPlaying = state.getBoolean("isPlaying")
    playPauseButton?.setImageResource(
      if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
    )
    if (state.hasKey("artBase64") && !state.isNull("artBase64")) {
      decodeArt(state.getString("artBase64"))?.let { artView?.setImageBitmap(it) }
    }
  }

  private fun decodeArt(b64: String?): Bitmap? {
    if (b64.isNullOrEmpty()) return null
    return runCatching {
      val bytes = Base64.decode(b64, Base64.DEFAULT)
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    }.getOrNull()
  }

  private fun runOnUi(block: () -> Unit) {
    // Lambda literal so Kotlin SAM-converts it to a Runnable.
    reactContext.runOnUiQueueThread { block() }
  }

  override fun invalidate() {
    hide()
    super.invalidate()
  }
}

// Track-position ring around the bubble, mirroring the in-app one (BubbleRing in
// PlayerBubble.tsx): a translucent full circle with the elapsed fraction swept over it
// in white, starting at 12 o'clock and going clockwise.
private class RingView(context: Context, private val stroke: Float) : View(context) {
  var progress: Float = 0f
    set(value) {
      val next = value.coerceIn(0f, 1f)
      if (next != field) { field = next; invalidate() }
    }

  private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = stroke
    color = Color.argb(89, 0, 0, 0) // rgba(0,0,0,0.35)
  }

  private val barPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeWidth = stroke
    strokeCap = Paint.Cap.ROUND
    color = Color.WHITE
  }

  // Themed accent, to match the in-app bubble. Ignores anything Color can't parse.
  fun setBarColor(hex: String) {
    val parsed = runCatching { Color.parseColor(hex) }.getOrNull() ?: return
    if (parsed != barPaint.color) { barPaint.color = parsed; invalidate() }
  }

  private val oval = RectF()

  override fun onDraw(canvas: Canvas) {
    // Inset by half the stroke so the ring's outer edge lands on the bubble's edge.
    val half = stroke / 2f
    oval.set(half, half, width - half, height - half)
    canvas.drawArc(oval, 0f, 360f, false, trackPaint)
    if (progress > 0f) canvas.drawArc(oval, -90f, 360f * progress, false, barPaint)
  }
}
