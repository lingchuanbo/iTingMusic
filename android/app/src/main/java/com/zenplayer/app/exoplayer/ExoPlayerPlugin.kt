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
    private var pendingEndedEvent = false // 标记是否有待处理的结束事件
    
    // 下一首歌曲信息 - 用于息屏时原生层自动切歌
    private data class NextTrackInfo(
        val url: String,
        val id: String,
        val title: String,
        val artist: String,
        val cover: String?
    )
    private var nextTrack: NextTrackInfo? = null

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
                    // 检查是否是真正的播放结束，而不是息屏导致的假结束
                    val player = controller
                    if (player != null) {
                        val duration = player.duration
                        val position = player.currentPosition
                        val progress = if (duration > 0) position.toFloat() / duration.toFloat() else 0f
                        
                        android.util.Log.e("ExoPlayerPlugin", "DEBUG: STATE_ENDED - position=$position, duration=$duration, progress=${(progress * 100).toInt()}%")
                        
                        // 只有当播放进度超过 95% 时才认为是真正的结束
                        // 否则可能是息屏导致的网络中断或缓冲问题
                        if (progress >= 0.95f || position >= duration - 1000) {
                            android.util.Log.e("ExoPlayerPlugin", "DEBUG: 歌曲真正播放结束")
                            
                            // 检查是否有下一首在播放队列中
                            // ExoPlayer 会自动切换，通过 onMediaItemTransition 事件通知前端
                            if (player.hasNextMediaItem()) {
                                android.util.Log.d("ExoPlayerPlugin", "DEBUG: ExoPlayer 队列有下一首，等待自动切换")
                                // 不需要手动操作，ExoPlayer 会自动切换
                                // 通过 onMediaItemTransition 事件通知前端
                            } else {
                                // 没有下一首在队列中，通知前端处理
                                android.util.Log.d("ExoPlayerPlugin", "DEBUG: 队列无下一首，通知前端处理")
                                sendEndedEventWithRetry(0)
                            }
                        } else {
                            // 可能是息屏导致的意外中断，尝试恢复播放
                            android.util.Log.w("ExoPlayerPlugin", "DEBUG: 疑似息屏导致的假结束 (progress=${(progress * 100).toInt()}%)，尝试恢复播放")
                            mainHandler.postDelayed({
                                controller?.let { p ->
                                    if (p.playbackState == Player.STATE_ENDED && !p.isPlaying) {
                                        // 从当前位置重新准备并播放
                                        p.seekTo(position)
                                        p.prepare()
                                        p.play()
                                        android.util.Log.d("ExoPlayerPlugin", "DEBUG: 已尝试恢复播放")
                                    }
                                }
                            }, 500)
                        }
                    } else {
                        android.util.Log.e("ExoPlayerPlugin", "DEBUG: 歌曲播放结束，发送 onEnded 事件")
                        sendEndedEventWithRetry(0)
                    }
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
                
                // MEDIA_ITEM_TRANSITION_REASON_AUTO = 1, 表示 ExoPlayer 自动切换到下一首（当前歌曲播放结束）
                // MEDIA_ITEM_TRANSITION_REASON_SEEK = 2, 表示通过 seek 切换
                // MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED = 0, 表示播放列表变化
                if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) {
                    android.util.Log.e("ExoPlayerPlugin", "DEBUG: ExoPlayer 自动切换到下一首: ${mediaItem?.mediaId}")
                    data.put("nativeAutoNext", true)
                } else {
                    android.util.Log.d("ExoPlayerPlugin", "DEBUG: 歌曲切换，原因: $reason, mediaId: ${mediaItem?.mediaId}")
                }
                
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

    /**
     * 带重试机制的 onEnded 事件发送
     * 息屏时 WebView 的 JS 引擎可能被挂起，需要多次发送确保能收到
     * 如果重试都失败，则原生层直接播放下一首
     */
    private fun sendEndedEventWithRetry(retryCount: Int) {
        val maxRetries = 3
        val retryDelay = 300L // 300ms 间隔
        
        // 标记有待处理的结束事件
        pendingEndedEvent = true
        
        // 发送事件
        val data = JSObject()
        data.put("event", "ended")
        data.put("retryCount", retryCount)
        notifyListeners("onEnded", data)
        android.util.Log.e("ExoPlayerPlugin", "DEBUG: 发送 onEnded 事件 (第 ${retryCount + 1} 次)")
        
        // 如果还没到最大重试次数，安排下一次重试
        if (retryCount < maxRetries - 1) {
            mainHandler.postDelayed({
                // 检查是否还需要重试（如果已经开始播放新歌曲，则不需要）
                controller?.let { player ->
                    // 如果仍然处于 ENDED 状态且没有在播放，继续重试
                    if (pendingEndedEvent && !player.isPlaying && player.playbackState == Player.STATE_ENDED) {
                        sendEndedEventWithRetry(retryCount + 1)
                    } else {
                        android.util.Log.d("ExoPlayerPlugin", "DEBUG: 停止重试，播放器状态已改变或已开始播放")
                        pendingEndedEvent = false
                    }
                }
            }, retryDelay)
        } else {
            // 已达到最大重试次数，WebView 无响应，尝试原生层自动切歌
            android.util.Log.e("ExoPlayerPlugin", "DEBUG: WebView 无响应，尝试原生层自动切歌")
            pendingEndedEvent = false
            playNextTrackNatively()
        }
    }
    
    /**
     * 原生层直接播放下一首歌曲
     * 当 WebView 无法响应时（如息屏）使用
     */
    private fun playNextTrackNatively() {
        val next = nextTrack
        if (next == null) {
            android.util.Log.w("ExoPlayerPlugin", "没有预设的下一首歌曲")
            return
        }
        
        android.util.Log.e("ExoPlayerPlugin", "DEBUG: 原生层自动播放下一首: ${next.title}, URL: ${next.url.take(50)}")
        
        // 确保在主线程执行
        mainHandler.post {
            controller?.let { player ->
                try {
                    val metadata = MediaMetadata.Builder()
                        .setTitle(next.title)
                        .setArtist(next.artist)
                        .apply {
                            next.cover?.let { setArtworkUri(android.net.Uri.parse(it)) }
                        }
                        .build()

                    val mediaItem = MediaItem.Builder()
                        .setUri(next.url)
                        .setMediaId(next.id)
                        .setMediaMetadata(metadata)
                        .build()

                    android.util.Log.d("ExoPlayerPlugin", "DEBUG: 开始设置 MediaItem 并播放")
                    player.setMediaItem(mediaItem)
                    player.prepare()
                    player.play()
                    android.util.Log.e("ExoPlayerPlugin", "DEBUG: play() 已调用，等待播放开始")
                    
                    // 清空已使用的下一首信息
                    nextTrack = null
                    
                    // 通知前端当前播放的歌曲变了
                    val changeData = JSObject()
                    changeData.put("mediaId", next.id)
                    changeData.put("nativeAutoNext", true)
                    notifyListeners("onTrackChange", changeData)
                } catch (e: Exception) {
                    android.util.Log.e("ExoPlayerPlugin", "DEBUG: playNextTrackNatively 异常", e)
                }
            } ?: run {
                android.util.Log.e("ExoPlayerPlugin", "DEBUG: controller 为 null，无法播放")
            }
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

        // 只在服务未连接时启动服务
        // 如果 controller 已连接，说明服务已经在运行，不需要重新启动
        if (controller == null) {
            val serviceIntent = android.content.Intent(ctx, ExoPlayerService::class.java)
            try {
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    ctx.startForegroundService(serviceIntent)
                } else {
                    ctx.startService(serviceIntent)
                }
            } catch (e: Exception) {
                // Android 12+ 后台启动前台服务限制
                android.util.Log.w("ExoPlayerPlugin", "无法启动前台服务: ${e.message}")
                // 如果服务尚未运行且无法启动，尝试普通启动
                try {
                    ctx.startService(serviceIntent)
                } catch (e2: Exception) {
                    android.util.Log.e("ExoPlayerPlugin", "服务启动失败: ${e2.message}")
                }
            }
        } else {
            android.util.Log.d("ExoPlayerPlugin", "服务已连接，跳过启动")
        }

    mainHandler.post {
            // 新歌曲开始播放，取消之前的 onEnded 重试
            pendingEndedEvent = false
            
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

                // 如果有下一首歌曲信息，使用 setMediaItems 添加两首歌曲
                // 这样锁屏控制会显示下一首按钮
                val next = nextTrack
                if (next != null) {
                    val nextMetadata = MediaMetadata.Builder()
                        .setTitle(next.title)
                        .setArtist(next.artist)
                        .apply {
                            next.cover?.let { setArtworkUri(android.net.Uri.parse(it)) }
                        }
                        .build()
                    
                    val nextMediaItem = MediaItem.Builder()
                        .setUri(next.url)
                        .setMediaId(next.id)
                        .setMediaMetadata(nextMetadata)
                        .build()
                    
                    player.setMediaItems(listOf(mediaItem, nextMediaItem), 0, 0)
                } else {
                    player.setMediaItem(mediaItem)
                }
                
                player.prepare()
                player.play()
                
                call.resolve(JSObject().put("success", true))
            } ?: call.reject("Player not ready")
        }
    }

    /**
     * 设置下一首歌曲信息
     * 前端在播放时调用此方法预设下一首，用于息屏时原生层自动切歌
     */
    @PluginMethod
    fun setNextTrack(call: PluginCall) {
        val url = call.getString("url")
        val id = call.getString("id")
        val title = call.getString("title") ?: "Unknown"
        val artist = call.getString("artist") ?: "Unknown"
        val cover = call.getString("cover")
        
        if (url != null && id != null) {
            nextTrack = NextTrackInfo(url, id, title, artist, cover)
            android.util.Log.d("ExoPlayerPlugin", "已设置下一首: $title")
            
            // 将下一首添加到 ExoPlayer 播放队列末尾
            // 这样歌曲结束后 ExoPlayer 可以自动切换
            mainHandler.post {
                controller?.let { player ->
                    // 只有当队列中没有下一首时才添加
                    if (!player.hasNextMediaItem()) {
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
                        
                        player.addMediaItem(mediaItem)
                        android.util.Log.e("ExoPlayerPlugin", "DEBUG: 已将下一首添加到队列: $title, 当前队列大小: ${player.mediaItemCount}")
                    } else {
                        android.util.Log.d("ExoPlayerPlugin", "队列已有下一首，跳过添加")
                    }
                }
            }
            
            call.resolve(JSObject().put("success", true))
        } else {
            // 清空下一首信息
            nextTrack = null
            call.resolve(JSObject().put("success", true).put("cleared", true))
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

    // ========== 缓存管理 ==========

    @PluginMethod
    fun getCacheStats(call: PluginCall) {
        mainHandler.post {
            val ctx = context
            if (ctx != null) {
                // 确保缓存已初始化
                ExoPlayerService.getCache(ctx)
            }
            val (size, count) = ExoPlayerService.getCacheStats()
            val result = JSObject()
            result.put("sizeBytes", size)
            result.put("sizeMB", size / 1024 / 1024)
            result.put("count", count)
            call.resolve(result)
        }
    }

    @PluginMethod
    fun isCached(call: PluginCall) {
        val mediaId = call.getString("mediaId") ?: run {
            call.reject("mediaId is required")
            return
        }
        mainHandler.post {
            val cached = ExoPlayerService.isCached(mediaId)
            call.resolve(JSObject().put("cached", cached))
        }
    }

    @PluginMethod
    fun clearCache(call: PluginCall) {
        mainHandler.post {
            ExoPlayerService.clearCache()
            call.resolve(JSObject().put("success", true))
        }
    }

    @PluginMethod
    fun getCachedSongs(call: PluginCall) {
        mainHandler.post {
            val ctx = context
            if (ctx != null) {
                // 确保缓存已初始化
                ExoPlayerService.getCache(ctx)
            }
            val keys = ExoPlayerService.getCachedKeys()
            val result = JSObject()
            result.put("keys", JSArray(keys))
            call.resolve(result)
        }
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        stopProgressUpdates()
        controllerFuture?.let { MediaController.releaseFuture(it) }
    }
}
