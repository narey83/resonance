# Custom background analysis

The Overview tab's background mode is independent of the manual mode on Analyse tracks. Choosing **Custom enhanced** saves a set of enhanced measurements for background queue jobs. Changing the mode or its options does not turn scheduling on; the existing Turn on/Turn off control retains that responsibility. When scheduling is on, waiting tracks use the saved mode and options.

`preparation-settings` is one JSON value in `workspace_settings`, so mode, measurements, cue preference and cue owner survive a process restart together. Existing installations with only `preparation-mode` retain that setting. The authenticated user who enables background auto cues owns the resulting listening bookmarks; the status endpoint does not return that username. The API validates measurement names and requires a write-capable role before saving options.

Custom jobs run Basic analysis and then the selected enhanced measurements. The candidate summary indexes the available full-track feature names. Background reconciliation marks a track `selected` only when Basic is complete and every requested measurement is available. Changing the feature list causes previously completed tracks that lack the new measurements to return to the background queue. Retry and pause behavior follows the existing background queue policy. A custom result may still lack measurements required for USB export.

Background mode changes can make currently indexed tracks eligible for analysis. Keep scheduling off when editing choices if the waiting queue should remain idle; review the queue before turning it on.
