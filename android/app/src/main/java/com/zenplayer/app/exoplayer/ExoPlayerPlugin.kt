package com.zenplayer.app.exoplayer

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import android.content.ComponentName
import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
@CapacitorPlugin(name = "ExoPlayer")
class ExoPlayerPlugin : Plugin() {

    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var progressRunnable: Runnable? = null
    private var isProgressUpdating = false

    override fun load() {
        super.load()
        connectToService()
    }

    private fun connectToService() {
        val context = context ?: return
        val sessionToken = SessionToken(context, ComponentName(context, ExoPlayerService::class.java))
        controllerFuture = MediaController.Builder(context, sessionToken).buildAsync()
        controllerFuture?.addListener({
            try {
                controller = controllerFuture?.get()
                setupPlayerListener()
                android.util.Log.d("ExoPlayerPlugin", "MediaController 连接成功")
            } catch (e: Exception) {
                android.util.Log.e("ExoPlayerPlugin", "MediaController 连接失败", e)
            }
        }, MoreExecutors.directExecutor())
    }

    private fun setupPlayerListener() {
        controller?.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                // 使用 Log.e 确保能在 Logcat 中明显看到
                android.util.Log.e("ExoPlayerPlugin", "DEBUG: 播放状态变化 -> $playbackState (4=ENDED)")
                notifyStateChange()
                // 检测播放结束（STATE_ENDED = 4）
                if (playbackState == Player.STATE_ENDED) {
                    android.util.Log.e("ExoPlayerPlugin", "DEBUG: 歌曲播放结束，触发 notifyListeners(onEnded)")
                    val data = JSObject()
                    data.put("event", "ended")
                    notifyListeners("onEnded", data)
                }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                notifyStateChange()
                if (isPlaying) {
                    startProgressUpdates()
                } else {
                    stopProgressUpdates()
                }
            }

            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                val data = JSObject()
                data.put("mediaId", mediaItem?.mediaId ?: "")
                data.put("reason", reason)
                notifyListeners("onTrackChange", data)
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                val data = JSObject()
                data.put("code", error.errorCode)
                data.put("message", error.message ?: "Unknown error")
                notifyListeners("onError", data)
            }
        })
    }

    private fun notifyStateChange() {
        controller?.let { player ->
            val data = JSObject()
            data.put("isPlaying", player.isPlaying)
            data.put("playbackState", player.playbackState)
            data.put("currentPosition", player.currentPosition)
            data.put("duration", player.duration.coerceAtLeast(0))
            data.put("mediaId", player.currentMediaItem?.mediaId ?: "")
            notifyListeners("onStateChange", data)
        }
    }

    private fun startProgressUpdates() {
        if (isProgressUpdating) return
        isProgressUpdating = true
        progressRunnable = object : Runnable {
            override fun run() {
                controller?.let { player ->
                    val data = JSObject()
                    data.put("currentPosition", player.currentPosition)
                    data.put("duration", player.duration.coerceAtLeast(0))
                    data.put("bufferedPosition", player.bufferedPosition)
                    notifyListeners("onProgress", data)
                }
                if (isProgressUpdating) {
                    mainHandler.postDelayed(this, 250)
                }
            }
        }
        mainHandler.post(progressRunnable!!)
    }

    private fun stopProgressUpdates() {
        isProgressUpdating = false
        progressRunnable?.let { mainHandler.removeCallbacks(it) }
    }

    @PluginMethod
    fun play(call: PluginCall) {
        val url = call.getString("url") ?: run {
            call.reject("URL is required")
            return
        }
        val id = call.getString("id") ?: url
        val title = call.getString("title") ?: "Unknown"
        val artist = call.getString("artist") ?: "Unknown"
        val cover = call.getString("cover")

        val ctx = context ?: run {
            call.reject("Context not available")
            return
        }

        // 确保服务以前台模式运行
        val serviceIntent = android.content.Intent(ctx, ExoPlayerService::class.java)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            ctx.startForegroundService(serviceIntent)
        } else {
            ctx.startService(serviceIntent)
        }

        mainHandler.post {
            controller?.let { player ->
                val metadata = MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(artist)
                    .apply {
                        cover?.let { setArtworkUri(android.net.Uri.parse(it)) }
                    }
                    .build()

                val mediaItem = MediaItem.Builder()
                    .setUri(url)
                    .setMediaId(id)
                    .setMediaMetadata(metadata)
                    .build()

                player.setMediaItem(mediaItem)
                player.prepare()
                player.play()
                
                call.resolve(JSObject().put("success", true))
            } ?: call.reject("Player not ready")
        }
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        mainHandler.post {
            controller?.pause()
            call.resolve(JSObject().put("success", true))
        }
    }

    @PluginMethod
    fun resume(call: PluginCall) {
        mainHandler.post {
            controller?.play()
            call.resolve(JSObject().put("success", true))
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        mainHandler.post {
            controller?.stop()
            call.resolve(JSObject().put("success", true))
        }
    }

    @PluginMethod
    fun seek(call: PluginCall) {
        val position = call.getDouble("position") ?: run {
            call.reject("Position is required")
            return
        }
        mainHandler.post {
            controller?.seekTo((position * 1000).toLong())
            call.resolve(JSObject().put("success", true))
        }
    }

    @PluginMethod
    fun setVolume(call: PluginCall) {
        val volume = call.getFloat("volume") ?: run {
            call.reject("Volume is required")
            return
        }
        mainHandler.post {
            controller?.volume = volume
            call.resolve(JSObject().put("success", true))
        }
    }

    @PluginMethod
    fun getState(call: PluginCall) {
        mainHandler.post {
            controller?.let { player ->
                val result = JSObject()
                result.put("isPlaying", player.isPlaying)
                result.put("playbackState", player.playbackState)
                result.put("currentPosition", player.currentPosition)
                result.put("duration", player.duration.coerceAtLeast(0))
                result.put("volume", player.volume)
                result.put("mediaId", player.currentMediaItem?.mediaId ?: "")
                call.resolve(result)
            } ?: run {
                // Controller 未连接时，返回完整的默认状态
                val result = JSObject()
                result.put("isPlaying", false)
                result.put("playbackState", 1) // STATE_IDLE
                result.put("currentPosition", 0)
                result.put("duration", 0)
                result.put("volume", 1.0f)
                result.put("mediaId", "")
                call.resolve(result)
            }
        }
    }

    @PluginMethod
    fun setPlaylist(call: PluginCall) {
        val tracks = call.getArray("tracks") ?: run {
            call.reject("Tracks array is required")
            return
        }
        val startIndex = call.getInt("startIndex") ?: 0

        mainHandler.post {
            controller?.let { player ->
                val mediaItems = mutableListOf<MediaItem>()
                for (i in 0 until tracks.length()) {
                    val track = tracks.getJSONObject(i)
                    val metadata = MediaMetadata.Builder()
                        .setTitle(track.optString("title", "Unknown"))
                        .setArtist(track.optString("artist", "Unknown"))
                        .apply {
                            track.optString("cover", null)?.let { 
                                setArtworkUri(android.net.Uri.parse(it)) 
                            }
                        }
                        .build()

                    val mediaItem = MediaItem.Builder()
                        .setUri(track.getString("url"))
                        .setMediaId(track.optString("id", track.getString("url")))
                        .setMediaMetadata(metadata)
                        .build()
                    mediaItems.add(mediaItem)
                }
                
                player.setMediaItems(mediaItems, startIndex, 0)
                player.prepare()
                player.play()
                call.resolve(JSObject().put("success", true))
            } ?: call.reject("Player not ready")
        }
    }

    @PluginMethod
    fun next(call: PluginCall) {
        mainHandler.post {
            controller?.let { player ->
                if (player.hasNextMediaItem()) {
                    player.seekToNext()
                }
                call.resolve(JSObject().put("success", true))
            } ?: call.reject("Player not ready")
        }
    }

    @PluginMethod
    fun checkListeners(call: PluginCall) {
        val eventNames = mutableListOf<String>()
        // 获取所有有监听器的事件
        if (hasListeners("onStateChange")) eventNames.add("onStateChange")
        if (hasListeners("onProgress")) eventNames.add("onProgress")
        if (hasListeners("onTrackChange")) eventNames.add("onTrackChange")
        if (hasListeners("onError")) eventNames.add("onError")
        if (hasListeners("onEnded")) eventNames.add("onEnded")
        
        android.util.Log.e("ExoPlayerPlugin", "DEBUG: 已注册的监听器 -> $eventNames")
        call.resolve(JSObject().put("listeners", JSArray(eventNames)))
    }

    @PluginMethod
    fun prev(call: PluginCall) {
        mainHandler.post {
            controller?.let { player ->
                if (player.hasPreviousMediaItem()) {
                    player.seekToPrevious()
                }
                call.resolve(JSObject().put("success", true))
            } ?: call.reject("Player not ready")
        }
    }

    @PluginMethod
    fun setPlayMode(call: PluginCall) {
        val mode = call.getString("mode") ?: "sequence"
        android.util.Log.d("ExoPlayerPlugin", "设置播放模式: $mode")
        mainHandler.post {
            controller?.let { player ->
                // 由前端管理切歌逻辑（随机、循环等）
                // 只有单曲循环需要 ExoPlayer 原生支持
                when (mode) {
                    "single" -> {
                        player.repeatMode = Player.REPEAT_MODE_ONE
                        player.shuffleModeEnabled = false
                        android.util.Log.d("ExoPlayerPlugin", "播放模式设置为: 单曲循环 (REPEAT_MODE_ONE)")
                    }
                    else -> {
                        // loop, shuffle, sequence 都由前端管理
                        // ExoPlayer 设置为不重复，歌曲结束后触发 STATE_ENDED
                        player.repeatMode = Player.REPEAT_MODE_OFF
                        player.shuffleModeEnabled = false
                        android.util.Log.d("ExoPlayerPlugin", "播放模式设置为: $mode (REPEAT_MODE_OFF，由前端管理切歌)")
                    }
                }
                call.resolve(JSObject().put("success", true))
            } ?: call.reject("Player not ready")
        }
    }

    // 均衡器相关方法
    @PluginMethod
    fun getAudioSessionId(call: PluginCall) {
        mainHandler.post {
            val sessionId = ExoPlayerService.audioSessionId
            call.resolve(JSObject().put("sessionId", sessionId))
        }
    }

    @PluginMethod
    fun setEqualizerEnabled(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: false
        mainHandler.post {
            ExoPlayerService.setEqualizerEnabled(enabled)
            call.resolve(JSObject().put("success", true))
        }
    }

    @PluginMethod
    fun setEqualizerBand(call: PluginCall) {
        val band = call.getInt("band") ?: run {
            call.reject("Band is required")
            return
        }
        val level = call.getInt("level") ?: run {
            call.reject("Level is required")
            return
        }
        mainHandler.post {
            ExoPlayerService.setEqualizerBand(band, level)
            call.resolve(JSObject().put("success", true))
        }
    }

    @PluginMethod
    fun getEqualizerBands(call: PluginCall) {
        mainHandler.post {
            val bands = ExoPlayerService.getEqualizerBands()
            val result = JSObject()
            result.put("bands", JSArray(bands.toList()))
            result.put("minLevel", ExoPlayerService.getEqualizerMinLevel())
            result.put("maxLevel", ExoPlayerService.getEqualizerMaxLevel())
            call.resolve(result)
        }
    }

    @PluginMethod
    fun setBassBoost(call: PluginCall) {
        val strength = call.getInt("strength") ?: 0
        mainHandler.post {
            ExoPlayerService.setBassBoost(strength)
            call.resolve(JSObject().put("success", true))
        }
    }

    @PluginMethod
    fun setVirtualizer(call: PluginCall) {
        val strength = call.getInt("strength") ?: 0
        mainHandler.post {
            ExoPlayerService.setVirtualizer(strength)
            call.resolve(JSObject().put("success", true))
        }
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        stopProgressUpdates()
        controllerFuture?.let { MediaController.releaseFuture(it) }
    }
}
