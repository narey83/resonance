package com.resonance.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Holds one read-only HTTPS poller while the user has explicitly enabled background chat. */
class BackgroundChatService : Service() {
  companion object {
    @Volatile var instance: BackgroundChatService? = null
    private const val SERVICE_ID = 47001
    private const val SERVICE_CHANNEL = "background-chat-service"
    private const val PRIVATE_CHANNEL = "private-messages-v2"
    private const val ROOM_CHANNEL = "room-mentions-v2"
  }

  private val executor = Executors.newSingleThreadScheduledExecutor()
  @Volatile private var serverUrl = ""
  @Volatile private var refreshToken = ""
  @Volatile private var sessionId = ""
  @Volatile private var privateMessages = true
  @Volatile private var roomMentions = true
  @Volatile private var appActive = true
  @Volatile private var cursor = 0L
  @Volatile private var unauthorizedCount = 0
  private var pollingStarted = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(SERVICE_CHANNEL, "Background chat connection", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Keeps Resonance connected for chat alerts"
        setShowBadge(false)
      })
      manager.createNotificationChannel(NotificationChannel(PRIVATE_CHANNEL, "Private messages", NotificationManager.IMPORTANCE_HIGH))
      manager.createNotificationChannel(NotificationChannel(ROOM_CHANNEL, "Room mentions", NotificationManager.IMPORTANCE_HIGH))
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null) return START_NOT_STICKY
    val nextUrl = intent.getStringExtra("serverUrl") ?: ""
    val nextToken = intent.getStringExtra("refreshToken") ?: ""
    val nextSession = intent.getStringExtra("sessionId") ?: ""
    if (!nextUrl.startsWith("https://", ignoreCase = true) || nextToken.isBlank() || nextSession.isBlank()) {
      stopSelf()
      return START_NOT_STICKY
    }

    if (sessionId != nextSession || serverUrl != nextUrl) cursor = 0L
    serverUrl = nextUrl
    refreshToken = nextToken
    sessionId = nextSession
    privateMessages = intent.getBooleanExtra("privateMessages", true)
    roomMentions = intent.getBooleanExtra("roomMentions", true)
    unauthorizedCount = 0
    val notification = notification("Resonance chat", "Listening for messages", SERVICE_CHANNEL, true, SERVICE_ID)
    if (Build.VERSION.SDK_INT >= 34) {
      startForeground(SERVICE_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
    } else {
      startForeground(SERVICE_ID, notification)
    }

    if (!pollingStarted) {
      pollingStarted = true
      executor.scheduleWithFixedDelay(::poll, 0, 15, TimeUnit.SECONDS)
    }
    return START_NOT_STICKY
  }

  fun update(token: String, pm: Boolean, room: Boolean) {
    if (token.isNotBlank()) {
      refreshToken = token
      unauthorizedCount = 0
    }
    privateMessages = pm
    roomMentions = room
  }

  fun setAppActive(active: Boolean) { appActive = active }

  fun isReady(): Boolean = pollingStarted && serverUrl.isNotBlank()

  override fun onDestroy() {
    instance = null
    executor.shutdownNow()
    super.onDestroy()
  }

  private fun poll() {
    val url = serverUrl
    val token = refreshToken
    if (url.isBlank() || token.isBlank()) return
    var connection: HttpURLConnection? = null
    try {
      connection = (URL("$url/api/v0/background-chat-alerts?after=$cursor").openConnection() as HttpURLConnection).apply {
        requestMethod = "GET"
        connectTimeout = 10000
        readTimeout = 10000
        setRequestProperty("Authorization", "Bearer $token")
        setRequestProperty("Accept", "application/json")
      }
      when (connection.responseCode) {
        401, 403 -> {
          if (++unauthorizedCount >= 2) stopSelf()
          return
        }
        200 -> unauthorizedCount = 0
        else -> return
      }
      val response = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
      val alerts = response.getJSONArray("alerts")
      if (!appActive) {
        for (index in 0 until alerts.length()) {
          val alert = alerts.getJSONObject(index)
          val kind = alert.optString("kind")
          if ((kind == "pm" && privateMessages) || (kind == "room" && roomMentions)) {
            val channel = if (kind == "pm") PRIVATE_CHANNEL else ROOM_CHANNEL
            val id = alert.getString("id").hashCode()
            val title = alert.getString("title")
            val body = alert.getString("body")
            getSystemService(NotificationManager::class.java).notify(id, notification(title, body, channel, false, id))
          }
        }
      }
      cursor = response.getLong("next")
    } catch (error: Exception) {
      // Network loss is expected; retry on the next poll without logging credentials or chat text.
      Log.w("BackgroundChat", "Chat alert poll unavailable: ${error.javaClass.simpleName}")
    } finally {
      connection?.disconnect()
    }
  }

  private fun notification(title: String, body: String, channel: String, ongoing: Boolean, requestCode: Int): Notification {
    val open = Intent(this, MainActivity::class.java).apply {
      action = Intent.ACTION_VIEW
      data = Uri.parse("resonance://chat?sid=${Uri.encode(sessionId)}")
      flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val pending = PendingIntent.getActivity(this, requestCode, open,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, channel) else Notification.Builder(this)
    return builder
      .setSmallIcon(android.R.drawable.ic_dialog_email)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(Notification.BigTextStyle().bigText(body))
      .setContentIntent(pending)
      .setOngoing(ongoing)
      .setAutoCancel(!ongoing)
      .build()
  }
}
