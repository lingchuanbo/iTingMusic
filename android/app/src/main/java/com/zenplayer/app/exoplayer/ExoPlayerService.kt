package com.zenplayer.app.exoplayer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.media.audiofx.Equalizer
import android.media.audiofx.LoudnessEnhancer
import android.os.Build
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.zenplayer.app.MainActivity
import com.zenplayer.app.R

@UnstableApi
class ExoPlayerService : MediaSessionService() {

    private var player: ExoPlayer? = null
    private var session: MediaSession? = null
    private var wifiLock: android.net.wifi.WifiManager.WifiLock? = null
    private var wakeLock: android.os.PowerManager.WakeLock? = null

    companion object {
        private const val CHANNEL_ID = "exoplayer_playback"
        private const val NOTIFICATION_ID = 2001

        @Volatile
        var audioSessionId: Int = 0
            private set
        
        private var equalizer: Equalizer? = null
        private var loudnessEnhancer: LoudnessEnhancer? = null
        private var virtualizer: android.media.audiofx.Virtualizer? = null
        private var equalizerEnabled = false

        fun setEqualizerEnabled(enabled: Boolean) {
            equalizerEnabled = enabled
            equalizer?.enabled = enabled
        }

        fun setEqualizerBand(band: Int, level: Int) {
            equalizer?.let { eq ->
                if (band in 0 until eq.numberOfBands) {
                    eq.setBandLevel(band.toShort(), level.toShort())
                }
            }
        }

        fun getEqualizerBands(): IntArray {
            return equalizer?.let { eq ->
                IntArray(eq.numberOfBands.toInt()) { i ->
                    eq.getCenterFreq(i.toShort())
                }
            } ?: intArrayOf()
        }

        fun getEqualizerMinLevel(): Int = equalizer?.bandLevelRange?.get(0)?.toInt() ?: -1500
        fun getEqualizerMaxLevel(): Int = equalizer?.bandLevelRange?.get(1)?.toInt() ?: 1500

        fun setBassBoost(strength: Int) {
            loudnessEnhancer?.let { enhancer ->
                if (strength <= 0) {
                    enhancer.enabled = false
                } else {
                    enhancer.enabled = true
                    // Convert 0-100 scale to mB (millibels), max ~1000mB
                    val gainMb = (strength * 10)
                    enhancer.setTargetGain(gainMb)
                }
            }
        }

        fun setVirtualizer(strength: Int) {
            virtualizer?.let { virt ->
                if (strength <= 0) {
                    virt.enabled = false
                } else {
                    virt.enabled = true
                    // Convert 0-100 scale to 0-1000
                    virt.setStrength((strength * 10).toShort())
                }
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        initializePlayer()
        initializeSession()
        
        // 配置媒体通知以确保后台播放
        setMediaNotificationProvider(
            androidx.media3.session.DefaultMediaNotificationProvider.Builder(this)
                .setChannelId(CHANNEL_ID)
                .setNotificationId(NOTIFICATION_ID)
                .build()
        )
    }

    override fun onStartCommand(intent: android.content.Intent?, flags: Int, startId: Int): Int {
        // 确保作为前台服务运行
        val notification = androidx.core.app.NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("音乐播放中")
            .setContentText("正在后台播放音乐")
            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        
        // 前台服务启动时立即获取 WakeLock 和 WifiLock
        acquireLocks()
        
        super.onStartCommand(intent, flags, startId)
        return START_STICKY
    }
    
    private fun acquireLocks() {
        wifiLock?.let { lock ->
            if (!lock.isHeld) {
                android.util.Log.d("ExoPlayerService", "前台服务启动，获取 WifiLock")
                lock.acquire()
            }
        }
        wakeLock?.let { lock ->
            if (!lock.isHeld) {
                android.util.Log.d("ExoPlayerService", "前台服务启动，获取 WakeLock")
                lock.acquire()
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "音乐播放",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "音乐播放控制"
                setShowBadge(false)
                setSound(null, null)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    private fun initializePlayer() {
        val audioAttributes = AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build()

        // 配置 OkHttp 客户端以支持重定向和自定义 User-Agent
        val okHttpClient = okhttp3.OkHttpClient.Builder()
            .followRedirects(true)
            .followSslRedirects(true)
            .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val request = chain.request().newBuilder()
                    .header("User-Agent", "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0.4472.120 Mobile Safari/537.36")
                    .build()
                chain.proceed(request)
            }
            .build()

        // 使用 OkHttp 数据源
        val dataSourceFactory = androidx.media3.datasource.okhttp.OkHttpDataSource.Factory(okHttpClient)
            .setUserAgent("Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0.4472.120 Mobile Safari/537.36")

        // 初始化 WifiLock 和 WakeLock 以防止息屏时 WiFi 进入休眠或 CPU 停止
        val wifiManager = applicationContext.getSystemService(android.content.Context.WIFI_SERVICE) as android.net.wifi.WifiManager
        wifiLock = wifiManager.createWifiLock(android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF, "iTingMusic:WifiLock")
        
        val powerManager = getSystemService(android.content.Context.POWER_SERVICE) as android.os.PowerManager
        // 使用 PARTIAL_WAKE_LOCK 保持 CPU 运行，即使屏幕关闭
        wakeLock = powerManager.newWakeLock(
            android.os.PowerManager.PARTIAL_WAKE_LOCK,
            "iTingMusic:WakeLock"
        )
        // 设置引用计数为 false，这样 acquire() 和 release() 调用不会嵌套
        wakeLock?.setReferenceCounted(false)

        player = ExoPlayer.Builder(this)
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            // 使用 WAKE_MODE_LOCAL 保持播放器唤醒，即使屏幕关闭
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .setMediaSourceFactory(
                androidx.media3.exoplayer.source.DefaultMediaSourceFactory(this)
                    .setDataSourceFactory(dataSourceFactory)
            )
            .build()
            .also {
                audioSessionId = it.audioSessionId
                initializeAudioEffects(it.audioSessionId)
                
                it.addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        android.util.Log.d("ExoPlayerService", "播放状态改变: $playbackState")
                        updateLocks(playbackState == Player.STATE_READY && it.playWhenReady)
                    }

                    override fun onIsPlayingChanged(isPlaying: Boolean) {
                        android.util.Log.d("ExoPlayerService", "播放中状态改变: $isPlaying")
                        updateLocks(isPlaying)
                    }
                    
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        android.util.Log.e("ExoPlayerService", "播放错误: ${error.errorCode} - ${error.message}")
                    }
                })
            }
    }

    private fun updateLocks(shouldLock: Boolean) {
        wifiLock?.let { lock ->
            if (shouldLock && !lock.isHeld) {
                android.util.Log.d("ExoPlayerService", "获取 WifiLock")
                lock.acquire()
            } else if (!shouldLock && lock.isHeld) {
                android.util.Log.d("ExoPlayerService", "释放 WifiLock")
                lock.release()
            }
        }
        wakeLock?.let { lock ->
            // 始终保持 WakeLock 获取状态，只要服务在前台运行
            // 这样可以防止息屏时 CPU 进入休眠
            if (!lock.isHeld) {
                android.util.Log.d("ExoPlayerService", "获取 WakeLock (持久)")
                lock.acquire()
            }
            // 不再释放 WakeLock，直到服务销毁
        }
    }

    private fun initializeAudioEffects(sessionId: Int) {
        try {
            equalizer = Equalizer(0, sessionId).apply {
                enabled = equalizerEnabled
            }
            android.util.Log.d("ExoPlayerService", "均衡器初始化成功, bands=${equalizer?.numberOfBands}")
        } catch (e: Exception) {
            android.util.Log.e("ExoPlayerService", "均衡器初始化失败", e)
        }

        try {
            loudnessEnhancer = LoudnessEnhancer(sessionId).apply {
                enabled = false
            }
            android.util.Log.d("ExoPlayerService", "低音增强初始化成功")
        } catch (e: Exception) {
            android.util.Log.e("ExoPlayerService", "低音增强初始化失败", e)
        }

        try {
            virtualizer = android.media.audiofx.Virtualizer(0, sessionId).apply {
                enabled = false
            }
            android.util.Log.d("ExoPlayerService", "环绕声初始化成功")
        } catch (e: Exception) {
            android.util.Log.e("ExoPlayerService", "环绕声初始化失败", e)
        }
    }

    private fun initializeSession() {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 配置 MediaSession Callback 以启用所有媒体控制按钮
        val callback = object : MediaSession.Callback {
            override fun onConnect(
                session: MediaSession,
                controller: MediaSession.ControllerInfo
            ): MediaSession.ConnectionResult {
                // 返回默认可用命令，包括 COMMAND_SEEK_TO_PREVIOUS 和 COMMAND_SEEK_TO_NEXT
                val sessionCommands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS
                val playerCommands = MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS
                return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                    .setAvailableSessionCommands(sessionCommands)
                    .setAvailablePlayerCommands(playerCommands)
                    .build()
            }
        }

        session = MediaSession.Builder(this, player!!)
            .setSessionActivity(pendingIntent)
            .setCallback(callback)
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
        return session
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = this.player ?: return stopSelf()
        if (!player.isPlaying) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        releaseAudioEffects()
        if (wifiLock?.isHeld == true) {
            wifiLock?.release()
        }
        wifiLock = null
        if (wakeLock?.isHeld == true) {
            wakeLock?.release()
        }
        wakeLock = null
        session?.let {
            player?.release()
            it.release()
        }
        session = null
        player = null
        super.onDestroy()
    }

    private fun releaseAudioEffects() {
        try {
            equalizer?.release()
            equalizer = null
        } catch (e: Exception) {
            android.util.Log.e("ExoPlayerService", "释放均衡器失败", e)
        }
        try {
            loudnessEnhancer?.release()
            loudnessEnhancer = null
        } catch (e: Exception) {
            android.util.Log.e("ExoPlayerService", "释放低音增强失败", e)
        }
        try {
            virtualizer?.release()
            virtualizer = null
        } catch (e: Exception) {
            android.util.Log.e("ExoPlayerService", "释放环绕声失败", e)
        }
    }
}
