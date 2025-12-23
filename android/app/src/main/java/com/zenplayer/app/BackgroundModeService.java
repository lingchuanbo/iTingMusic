package com.zenplayer.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class BackgroundModeService extends Service {
    
    public static final String ACTION_START = "com.zenplayer.app.START";
    public static final String ACTION_STOP = "com.zenplayer.app.STOP";
    public static final String ACTION_UPDATE = "com.zenplayer.app.UPDATE";
    public static final String ACTION_PLAY_PAUSE = "com.zenplayer.app.PLAY_PAUSE";
    public static final String ACTION_NEXT = "com.zenplayer.app.NEXT";
    public static final String ACTION_PREV = "com.zenplayer.app.PREV";
    public static final String ACTION_UPDATE_STATE = "com.zenplayer.app.UPDATE_STATE";
    public static final String ACTION_UPDATE_PROGRESS = "com.zenplayer.app.UPDATE_PROGRESS";
    public static final String ACTION_TOGGLE_LYRICS = "com.zenplayer.app.TOGGLE_LYRICS";
    
    private static final String CHANNEL_ID = "zenplayer_playback";
    private static final int NOTIFICATION_ID = 1001;
    
    public static boolean isRunning = false;
    
    private PowerManager.WakeLock wakeLock;
    private MediaSessionCompat mediaSession;
    private String currentTitle = "正在播放";
    private String currentArtist = "未知艺术家";
    private String currentCover = "";
    private boolean isPlaying = false;
    private boolean showLyrics = false;
    private long currentPosition = 0;
    private long currentDuration = 0;
    private Bitmap coverBitmap = null;
    private ExecutorService executor = Executors.newSingleThreadExecutor();
    private Handler mainHandler = new Handler(Looper.getMainLooper());

    // 广播接收器 - 接收来自前端的控制命令响应
    private BroadcastReceiver controlReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            // 处理来自前端的状态更新
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        createMediaSession();
        acquireWakeLock();
        
        // 注册广播接收器
        IntentFilter filter = new IntentFilter();
        filter.addAction("com.zenplayer.app.STATE_CHANGED");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(controlReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(controlReceiver, filter);
        }
    }

    private void createMediaSession() {
        mediaSession = new MediaSessionCompat(this, "ZenPlayerSession");
        
        // 设置媒体按钮接收器
        Intent mediaButtonIntent = new Intent(Intent.ACTION_MEDIA_BUTTON);
        mediaButtonIntent.setPackage(getPackageName());
        PendingIntent mediaPendingIntent = PendingIntent.getBroadcast(
            this, 0, mediaButtonIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        mediaSession.setMediaButtonReceiver(mediaPendingIntent);
        
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                android.util.Log.d("BackgroundModeService", "MediaSession onPlay");
                isPlaying = true;
                updatePlaybackState();
                updateNotification();
                sendControlBroadcast(ACTION_PLAY_PAUSE);
            }

            @Override
            public void onPause() {
                android.util.Log.d("BackgroundModeService", "MediaSession onPause");
                isPlaying = false;
                updatePlaybackState();
                updateNotification();
                sendControlBroadcast(ACTION_PLAY_PAUSE);
            }

            @Override
            public void onSkipToNext() {
                android.util.Log.d("BackgroundModeService", "MediaSession onSkipToNext");
                sendControlBroadcast(ACTION_NEXT);
            }

            @Override
            public void onSkipToPrevious() {
                android.util.Log.d("BackgroundModeService", "MediaSession onSkipToPrevious");
                sendControlBroadcast(ACTION_PREV);
            }
            
            @Override
            public boolean onMediaButtonEvent(Intent mediaButtonEvent) {
                android.util.Log.d("BackgroundModeService", "MediaSession onMediaButtonEvent");
                return super.onMediaButtonEvent(mediaButtonEvent);
            }
        });
        mediaSession.setActive(true);
        updatePlaybackState();
    }

    private void sendControlBroadcast(String action) {
        android.util.Log.d("BackgroundModeService", "发送控制广播: " + action);
        Intent intent = new Intent(action);
        intent.setPackage(getPackageName());
        sendBroadcast(intent);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            return START_STICKY;
        }
        
        String action = intent.getAction();
        
        if (ACTION_START.equals(action)) {
            currentTitle = intent.getStringExtra("title");
            currentArtist = intent.getStringExtra("artist");
            currentCover = intent.getStringExtra("cover");
            isPlaying = intent.getBooleanExtra("isPlaying", true);
            currentDuration = intent.getLongExtra("duration", 0);
            currentPosition = 0;
            if (currentTitle == null) currentTitle = "正在播放";
            if (currentArtist == null) currentArtist = "未知艺术家";
            if (currentCover == null) currentCover = "";
            
            loadCoverAndNotify(true);
            isRunning = true;
            
        } else if (ACTION_STOP.equals(action)) {
            stopForeground(true);
            stopSelf();
            isRunning = false;
            
        } else if (ACTION_UPDATE.equals(action)) {
            currentTitle = intent.getStringExtra("title");
            currentArtist = intent.getStringExtra("artist");
            String newCover = intent.getStringExtra("cover");
            currentDuration = intent.getLongExtra("duration", currentDuration);
            currentPosition = 0;
            if (currentTitle == null) currentTitle = "正在播放";
            if (currentArtist == null) currentArtist = "未知艺术家";
            
            // 只有封面变化时才重新加载
            if (newCover != null && !newCover.equals(currentCover)) {
                currentCover = newCover;
                loadCoverAndNotify(false);
            } else {
                updateMediaMetadata();
                updateNotification();
            }
            
        } else if (ACTION_UPDATE_STATE.equals(action)) {
            isPlaying = intent.getBooleanExtra("isPlaying", isPlaying);
            updatePlaybackState();
            updateNotification();
            
        } else if (ACTION_UPDATE_PROGRESS.equals(action)) {
            currentPosition = intent.getLongExtra("position", currentPosition);
            currentDuration = intent.getLongExtra("duration", currentDuration);
            updatePlaybackState();
        } else if (ACTION_PLAY_PAUSE.equals(action)) {
            // 通知栏播放/暂停按钮点击 - 直接通过 Capacitor 事件通知前端
            android.util.Log.d("BackgroundModeService", "收到 PLAY_PAUSE 命令");
            // 切换本地状态
            isPlaying = !isPlaying;
            updatePlaybackState();
            updateNotification();
            // 发送广播给 Plugin
            sendControlBroadcast(ACTION_PLAY_PAUSE);
        } else if (ACTION_NEXT.equals(action)) {
            // 通知栏下一首按钮点击
            android.util.Log.d("BackgroundModeService", "收到 NEXT 命令");
            sendControlBroadcast(ACTION_NEXT);
        } else if (ACTION_PREV.equals(action)) {
            // 通知栏上一首按钮点击
            android.util.Log.d("BackgroundModeService", "收到 PREV 命令");
            sendControlBroadcast(ACTION_PREV);
        } else if (ACTION_TOGGLE_LYRICS.equals(action)) {
            // 通知栏歌词按钮点击
            android.util.Log.d("BackgroundModeService", "收到 TOGGLE_LYRICS 命令");
            showLyrics = !showLyrics;
            updateNotification();
            sendControlBroadcast(ACTION_TOGGLE_LYRICS);
        }
        
        return START_STICKY;
    }

    private void loadCoverAndNotify(boolean startForeground) {
        if (currentCover != null && !currentCover.isEmpty()) {
            executor.execute(() -> {
                Bitmap bitmap = loadBitmapFromUrl(currentCover);
                mainHandler.post(() -> {
                    coverBitmap = bitmap;
                    updateMediaMetadata();
                    if (startForeground) {
                        startForegroundWithNotification();
                    } else {
                        updateNotification();
                    }
                });
            });
        } else {
            coverBitmap = null;
            updateMediaMetadata();
            if (startForeground) {
                startForegroundWithNotification();
            } else {
                updateNotification();
            }
        }
    }

    private Bitmap loadBitmapFromUrl(String urlString) {
        try {
            URL url = new URL(urlString);
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setDoInput(true);
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            connection.connect();
            InputStream input = connection.getInputStream();
            Bitmap bitmap = BitmapFactory.decodeStream(input);
            input.close();
            return bitmap;
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    private void updateMediaMetadata() {
        MediaMetadataCompat.Builder builder = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, currentTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, currentArtist)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDuration);
        
        if (coverBitmap != null) {
            builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, coverBitmap);
        }
        
        mediaSession.setMetadata(builder.build());
    }

    private void updatePlaybackState() {
        int state = isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        PlaybackStateCompat.Builder builder = new PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY |
                PlaybackStateCompat.ACTION_PAUSE |
                PlaybackStateCompat.ACTION_PLAY_PAUSE |
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
                PlaybackStateCompat.ACTION_SEEK_TO
            )
            .setState(state, currentPosition, isPlaying ? 1.0f : 0f);
        
        mediaSession.setPlaybackState(builder.build());
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "音乐播放",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("后台音乐播放通知");
            channel.setShowBadge(false);
            channel.setSound(null, null);
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void startForegroundWithNotification() {
        Notification notification = buildNotification();
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // 使用 MediaSession 的 action 来处理按钮点击
        // 上一首
        Intent prevIntent = new Intent(Intent.ACTION_MEDIA_BUTTON);
        prevIntent.setPackage(getPackageName());
        prevIntent.putExtra(Intent.EXTRA_KEY_EVENT, 
            new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS));
        PendingIntent prevPendingIntent = PendingIntent.getBroadcast(
            this, 1, prevIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // 播放/暂停
        Intent playPauseIntent = new Intent(Intent.ACTION_MEDIA_BUTTON);
        playPauseIntent.setPackage(getPackageName());
        playPauseIntent.putExtra(Intent.EXTRA_KEY_EVENT,
            new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, 
                isPlaying ? android.view.KeyEvent.KEYCODE_MEDIA_PAUSE : android.view.KeyEvent.KEYCODE_MEDIA_PLAY));
        PendingIntent playPausePendingIntent = PendingIntent.getBroadcast(
            this, 2, playPauseIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // 下一首
        Intent nextIntent = new Intent(Intent.ACTION_MEDIA_BUTTON);
        nextIntent.setPackage(getPackageName());
        nextIntent.putExtra(Intent.EXTRA_KEY_EVENT,
            new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN, android.view.KeyEvent.KEYCODE_MEDIA_NEXT));
        PendingIntent nextPendingIntent = PendingIntent.getBroadcast(
            this, 3, nextIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // 歌词开关
        Intent lyricsIntent = new Intent(this, BackgroundModeService.class);
        lyricsIntent.setAction(ACTION_TOGGLE_LYRICS);
        PendingIntent lyricsPendingIntent = PendingIntent.getService(
            this, 4, lyricsIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // 构建通知
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(currentTitle)
            .setContentText(currentArtist)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(android.R.drawable.ic_media_previous, "上一首", prevPendingIntent)
            .addAction(
                isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                isPlaying ? "暂停" : "播放",
                playPausePendingIntent
            )
            .addAction(android.R.drawable.ic_media_next, "下一首", nextPendingIntent)
            .addAction(
                android.R.drawable.ic_btn_speak_now,
                showLyrics ? "隐藏词" : "显示词",
                lyricsPendingIntent
            )
            .setStyle(new MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2)
            );

        if (coverBitmap != null) {
            builder.setLargeIcon(coverBitmap);
        }

        return builder.build();
    }

    private void updateNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private void acquireWakeLock() {
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "ZenPlayer::BackgroundPlayback"
            );
            wakeLock.acquire();
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        releaseWakeLock();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        try {
            unregisterReceiver(controlReceiver);
        } catch (Exception e) {
            // ignore
        }
        isRunning = false;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
