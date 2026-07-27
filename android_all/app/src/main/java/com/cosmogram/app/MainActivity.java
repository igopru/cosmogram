package com.cosmogram.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private ProgressBar progressBar;
    private SwipeRefreshLayout swipeRefresh;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraPhotoUri;
    private SharedPreferences prefs;
    private static final String PREF_SERVER_URL = "server_url";
    private static final String DEFAULT_URL = "https://cosmogram.rupru.ru";
    private static final int PERMISSION_REQUEST_CODE = 100;
    private static final String AUTHORITY = "com.cosmogram.app.fileprovider";

    private final ActivityResultLauncher<Intent> fileChooserLauncher =
            registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
                if (filePathCallback == null) return;
                Uri[] uris = null;
                if (result.getResultCode() == Activity.RESULT_OK) {
                    Intent data = result.getData();
                    if (data != null) {
                        Uri singleUri = data.getData();
                        if (singleUri != null) {
                            uris = new Uri[]{singleUri};
                        } else if (data.getClipData() != null) {
                            int count = data.getClipData().getItemCount();
                            uris = new Uri[count];
                            for (int i = 0; i < count; i++) {
                                uris[i] = data.getClipData().getItemAt(i).getUri();
                            }
                        }
                    }
                    if (uris == null && cameraPhotoUri != null) {
                        uris = new Uri[]{cameraPhotoUri};
                    }
                }
                filePathCallback.onReceiveValue(uris);
                filePathCallback = null;
                cameraPhotoUri = null;
            });

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        progressBar = findViewById(R.id.progressBar);
        swipeRefresh = findViewById(R.id.swipeRefresh);
        prefs = getPreferences(MODE_PRIVATE);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        CookieManager.getInstance().setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
                swipeRefresh.setRefreshing(false);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                return !url.startsWith("http://") && !url.startsWith("https://");
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress < 100) {
                    progressBar.setVisibility(View.VISIBLE);
                    progressBar.setProgress(newProgress);
                } else {
                    progressBar.setVisibility(View.GONE);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> filePath,
                                             FileChooserParams fileChooserParams) {
                filePathCallback = filePath;

                Intent pickerIntent = new Intent(Intent.ACTION_GET_CONTENT);
                pickerIntent.addCategory(Intent.CATEGORY_OPENABLE);
                pickerIntent.setType("*/*");
                pickerIntent.putExtra(Intent.EXTRA_MIME_TYPES,
                        new String[]{"image/*", "video/*"});
                pickerIntent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);

                Intent cameraIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                File photoFile = createImageFile();
                if (photoFile != null) {
                    cameraPhotoUri = FileProvider.getUriForFile(
                            MainActivity.this, AUTHORITY, photoFile);
                    cameraIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraPhotoUri);
                }

                Intent chooser = Intent.createChooser(pickerIntent, "Select media");
                if (cameraIntent.resolveActivity(getPackageManager()) != null) {
                    chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS,
                            new Intent[]{cameraIntent});
                }

                fileChooserLauncher.launch(chooser);
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    request.grant(request.getResources());
                }
            }
        });

        webView.setOnScrollChangeListener((v, scrollX, scrollY, oldScrollX, oldScrollY) ->
                swipeRefresh.setEnabled(scrollY == 0));

        swipeRefresh.setOnRefreshListener(() -> webView.reload());

        requestPermissions();
        showUrlDialog();
    }

    private File createImageFile() {
        String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US)
                .format(new Date());
        File dir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        if (dir == null) return null;
        try {
            return File.createTempFile("IMG_" + timeStamp, ".jpg", dir);
        } catch (IOException e) {
            return null;
        }
    }

    private void requestPermissions() {
        List<String> permissions = new ArrayList<>();
        permissions.add(Manifest.permission.CAMERA);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.READ_MEDIA_IMAGES);
            permissions.add(Manifest.permission.READ_MEDIA_VIDEO);
        } else {
            permissions.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }

        List<String> needed = new ArrayList<>();
        for (String p : permissions) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                needed.add(p);
            }
        }

        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(this,
                    needed.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    private void showUrlDialog() {
        String savedUrl = prefs.getString(PREF_SERVER_URL, DEFAULT_URL);

        AlertDialog.Builder builder = new AlertDialog.Builder(this, R.style.Theme_Cosmogram_Dialog);
        builder.setTitle("Cosmogram Server");

        View dialogView = getLayoutInflater().inflate(R.layout.dialog_server_url, null);
        androidx.appcompat.widget.AppCompatEditText urlInput =
                dialogView.findViewById(R.id.serverUrlInput);
        urlInput.setText(savedUrl);
        urlInput.setSelection(savedUrl.length());

        builder.setView(dialogView);
        builder.setPositiveButton("Connect", (dialog, which) -> {
            String url = urlInput.getText().toString().trim();
            if (url.isEmpty()) {
                url = DEFAULT_URL;
            }
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                url = "http://" + url;
            }
            if (url.endsWith("/")) {
                url = url.substring(0, url.length() - 1);
            }

            prefs.edit().putString(PREF_SERVER_URL, url).apply();
            webView.loadUrl(url);
        });

        builder.setNeutralButton("Defaults", (dialog, which) -> {
            prefs.edit().putString(PREF_SERVER_URL, DEFAULT_URL).apply();
            webView.loadUrl(DEFAULT_URL);
        });

        AlertDialog dialog = builder.create();
        dialog.setCancelable(false);
        dialog.show();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(@Nullable Bundle outState) {
        super.onSaveInstanceState(outState);
        if (outState != null) webView.saveState(outState);
    }

    @Override
    protected void onRestoreInstanceState(@Nullable Bundle savedInstanceState) {
        super.onRestoreInstanceState(savedInstanceState);
        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
    }
}
