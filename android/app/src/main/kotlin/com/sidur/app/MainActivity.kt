package com.sidur.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.*
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import java.io.File

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true   // localStorage (for prefs like viewMode)
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        // Only our GitHub Pages origin can call the bridge
        webView.addJavascriptInterface(StorageBridge(filesDir), "SidurBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Block navigation to any host other than GitHub Pages
                val host = request.url.host ?: return true
                return !host.endsWith("github.io")
            }
        }

        webView.loadUrl("https://dn-scribe.github.io/sidur/")
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}

/**
 * Exposes four synchronous file operations to JavaScript.
 * Files are stored in the app's private filesDir — survives across app restarts,
 * but not uninstall. Use the in-app export/import to back data up to a file.
 *
 * Path rules: relative, no ".." traversal enforced by canonical path check.
 */
class StorageBridge(private val root: File) {

    private fun safe(path: String): File? {
        val f = File(root, path).canonicalFile
        return if (f.path.startsWith(root.canonicalPath)) f else null
    }

    /** Returns file contents as a string, or null if the file does not exist. */
    @JavascriptInterface
    fun bridgeRead(path: String): String? = safe(path)?.takeIf { it.exists() }?.readText()

    /** Writes content to path, creating parent directories as needed. */
    @JavascriptInterface
    fun bridgeWrite(path: String, data: String) {
        safe(path)?.let { f -> f.parentFile?.mkdirs(); f.writeText(data) }
    }

    /** Returns a JSON array of filenames (not full paths) inside the given directory. */
    @JavascriptInterface
    fun bridgeList(dirPath: String): String {
        val dir = safe(dirPath) ?: return "[]"
        val names = dir.listFiles()?.filter { it.isFile }?.map { it.name } ?: emptyList()
        return JSONArray(names).toString()
    }

    /** Deletes a single file. Silently does nothing if the file is absent. */
    @JavascriptInterface
    fun bridgeDelete(path: String) { safe(path)?.delete() }
}
