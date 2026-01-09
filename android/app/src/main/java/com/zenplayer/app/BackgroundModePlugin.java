package com.zenplayer.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

@CapacitorPlugin(name = "BackgroundMode")
public class BackgroundModePlugin extends Plugin {

    private BroadcastReceiver controlReceiver;
    private boolean receiverRegistered = false;

    @Override
    public void load() {
        super.load();
        registerControlReceiver();
    }

    private void registerControlReceiver() {
        if (receiverRegistered) return;
        
        android.util.Log.d("BackgroundModePlugin", "注册广播接收器");
        
        controlReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();
                if (action == null) return;
                
                android.util.Log.d("BackgroundModePlugin", "收到广播: " + action);
                
                JSObject data = new JSObject();
                
                switch (action) {
                    case BackgroundModeService.ACTION_PLAY_PAUSE:
                        android.util.Log.d("BackgroundModePlugin", "通知前端: playPause");
                        data.put("action", "playPause");
                        notifyListeners("controlAction", data);
                        break;
                    case BackgroundModeService.ACTION_NEXT:
                        android.util.Log.d("BackgroundModePlugin", "通知前端: next");
                        data.put("action", "next");
                        notifyListeners("controlAction", data);
                        break;
                    case BackgroundModeService.ACTION_PREV:
                        android.util.Log.d("BackgroundModePlugin", "通知前端: prev");
                        data.put("action", "prev");
                        notifyListeners("controlAction", data);
                        break;
                    case BackgroundModeService.ACTION_TOGGLE_LYRICS:
                        android.util.Log.d("BackgroundModePlugin", "通知前端: toggleLyrics");
                        data.put("action", "toggleLyrics");
                        notifyListeners("controlAction", data);
                        break;
                    case BackgroundModeService.ACTION_AUDIO_FOCUS_LOSS:
                        android.util.Log.d("BackgroundModePlugin", "通知前端: audioFocusLoss");
                        data.put("action", "audioFocusLoss");
                        notifyListeners("controlAction", data);
                        break;
                    case BackgroundModeService.ACTION_AUDIO_FOCUS_GAIN:
                        android.util.Log.d("BackgroundModePlugin", "通知前端: audioFocusGain");
                        data.put("action", "audioFocusGain");
                        notifyListeners("controlAction", data);
                        break;
                    case BackgroundModeService.ACTION_AUDIO_BECOMING_NOISY:
                        android.util.Log.d("BackgroundModePlugin", "通知前端: audioBecomingNoisy");
                        data.put("action", "audioBecomingNoisy");
                        notifyListeners("controlAction", data);
                        break;
                }
            }
        };
        
        IntentFilter filter = new IntentFilter();
        filter.addAction(BackgroundModeService.ACTION_PLAY_PAUSE);
        filter.addAction(BackgroundModeService.ACTION_NEXT);
        filter.addAction(BackgroundModeService.ACTION_PREV);
        filter.addAction(BackgroundModeService.ACTION_TOGGLE_LYRICS);
        filter.addAction(BackgroundModeService.ACTION_AUDIO_FOCUS_LOSS);
        filter.addAction(BackgroundModeService.ACTION_AUDIO_FOCUS_GAIN);
        filter.addAction(BackgroundModeService.ACTION_AUDIO_BECOMING_NOISY);
        
        Context context = getContext();
        // 使用 RECEIVER_EXPORTED 因为广播来自同一应用的 Service
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(controlReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            context.registerReceiver(controlReceiver, filter);
        }
        receiverRegistered = true;
        android.util.Log.d("BackgroundModePlugin", "广播接收器注册完成");
    }

    @PluginMethod
    public void enable(PluginCall call) {
        String title = call.getString("title", "正在播放");
        String artist = call.getString("artist", "未知艺术家");
        String cover = call.getString("cover", "");
        Boolean isPlaying = call.getBoolean("isPlaying", true);
        Double duration = call.getDouble("duration", 0.0);
        
        Context context = getContext();
        Intent serviceIntent = new Intent(context, BackgroundModeService.class);
        serviceIntent.setAction(BackgroundModeService.ACTION_START);
        serviceIntent.putExtra("title", title);
        serviceIntent.putExtra("artist", artist);
        serviceIntent.putExtra("cover", cover);
        serviceIntent.putExtra("isPlaying", isPlaying);
        serviceIntent.putExtra("duration", (long)(duration * 1000)); // 转换为毫秒
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }
        
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void disable(PluginCall call) {
        Context context = getContext();
        Intent serviceIntent = new Intent(context, BackgroundModeService.class);
        serviceIntent.setAction(BackgroundModeService.ACTION_STOP);
        context.startService(serviceIntent);
        
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void updateNotification(PluginCall call) {
        String title = call.getString("title", "正在播放");
        String artist = call.getString("artist", "未知艺术家");
        String cover = call.getString("cover", "");
        Double duration = call.getDouble("duration", 0.0);
        
        Context context = getContext();
        Intent serviceIntent = new Intent(context, BackgroundModeService.class);
        serviceIntent.setAction(BackgroundModeService.ACTION_UPDATE);
        serviceIntent.putExtra("title", title);
        serviceIntent.putExtra("artist", artist);
        serviceIntent.putExtra("cover", cover);
        serviceIntent.putExtra("duration", (long)(duration * 1000));
        context.startService(serviceIntent);
        
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void updatePlayState(PluginCall call) {
        Boolean isPlaying = call.getBoolean("isPlaying", false);
        
        Context context = getContext();
        Intent serviceIntent = new Intent(context, BackgroundModeService.class);
        serviceIntent.setAction(BackgroundModeService.ACTION_UPDATE_STATE);
        serviceIntent.putExtra("isPlaying", isPlaying);
        context.startService(serviceIntent);
        
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void updateProgress(PluginCall call) {
        Double position = call.getDouble("position", 0.0);
        Double duration = call.getDouble("duration", 0.0);
        
        Context context = getContext();
        Intent serviceIntent = new Intent(context, BackgroundModeService.class);
        serviceIntent.setAction(BackgroundModeService.ACTION_UPDATE_PROGRESS);
        // 前端传的已经是毫秒，直接使用
        serviceIntent.putExtra("position", position.longValue());
        serviceIntent.putExtra("duration", duration.longValue());
        context.startService(serviceIntent);
        
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", BackgroundModeService.isRunning);
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        if (receiverRegistered && controlReceiver != null) {
            try {
                getContext().unregisterReceiver(controlReceiver);
            } catch (Exception e) {
                // ignore
            }
            receiverRegistered = false;
        }
    }
}
