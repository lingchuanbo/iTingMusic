package com.zenplayer.app

import android.app.Application
import android.util.Log
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

class MainApplication : Application() {
    
    companion object {
        private const val TAG = "MainApplication"
    }
    
    override fun onCreate() {
        super.onCreate()
        
        // 配置信任所有证书的 SSL 上下文
        // 这是为了解决某些服务器证书链不完整的问题
        try {
            setupTrustAllCertificates()
            Log.i(TAG, "SSL trust-all certificates configured successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to setup SSL trust-all: ${e.message}")
        }
    }
    
    private fun setupTrustAllCertificates() {
        // 创建一个信任所有证书的 TrustManager
        val trustAllCerts = arrayOf<TrustManager>(object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                // 信任所有客户端证书
            }
            
            override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
                // 信任所有服务器证书
            }
            
            override fun getAcceptedIssuers(): Array<X509Certificate> {
                return arrayOf()
            }
        })
        
        // 创建 SSL 上下文
        val sslContext = SSLContext.getInstance("TLS")
        sslContext.init(null, trustAllCerts, SecureRandom())
        
        // 设置默认的 SSL Socket Factory
        HttpsURLConnection.setDefaultSSLSocketFactory(sslContext.socketFactory)
        
        // 设置默认的 HostnameVerifier，信任所有主机名
        HttpsURLConnection.setDefaultHostnameVerifier { _, _ -> true }
    }
}
