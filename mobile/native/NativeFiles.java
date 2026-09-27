package fr.electricad.app;

import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

// Fichiers et impression dans l'application Android : la WebView ne sait ni
// télécharger un « blob: » ni imprimer. Les exports (SVG, DXF, CSV, PNG, projet)
// vont dans Téléchargements/ElectriCAD, avec le partage proposé ; les dossiers
// passent par l'impression Android (et son « Enregistrer au format PDF »).
@CapacitorPlugin(name = "ElectriCAD")
public class NativeFiles extends Plugin {
    private WebView printView; // référence gardée pendant l'impression

    @PluginMethod
    public void saveFile(PluginCall call) {
        String data = call.getString("data");
        String name = call.getString("name", "fichier");
        String mime = call.getString("mime", "application/octet-stream");
        Boolean share = call.getBoolean("share", true);
        if (data == null) { call.reject("Aucune donnée"); return; }
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            Uri uri;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/ElectriCAD");
                uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) { call.reject("Téléchargements inaccessibles"); return; }
                try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) {
                    if (os == null) { call.reject("Écriture impossible"); return; }
                    os.write(bytes);
                }
            } else {
                File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "ElectriCAD");
                if (!dir.exists() && !dir.mkdirs()) { call.reject("Dossier impossible à créer"); return; }
                File f = new File(dir, name);
                try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            }
            final Uri shared = uri;
            final boolean doShare = share == null || share;
            getActivity().runOnUiThread(() -> {
                Toast.makeText(getContext(), "Enregistré dans Téléchargements/ElectriCAD : " + name, Toast.LENGTH_LONG).show();
                if (doShare) {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType(mime);
                    i.putExtra(Intent.EXTRA_STREAM, shared);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    getActivity().startActivity(Intent.createChooser(i, "Partager " + name));
                }
            });
            JSObject ret = new JSObject();
            ret.put("path", "Téléchargements/ElectriCAD/" + name);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Enregistrement impossible : " + e.getMessage());
        }
    }

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html");
        String title = call.getString("title", "ElectriCAD");
        Boolean a3 = call.getBoolean("a3", true);
        if (html == null) { call.reject("Aucun document"); return; }
        final boolean big = a3 == null || a3;
        getActivity().runOnUiThread(() -> {
            WebView wv = new WebView(getActivity());
            wv.getSettings().setJavaScriptEnabled(false);
            wv.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView view, String url) {
                    PrintManager pm = (PrintManager) getActivity().getSystemService(android.content.Context.PRINT_SERVICE);
                    PrintAttributes.Builder b = new PrintAttributes.Builder();
                    b.setMediaSize(big ? PrintAttributes.MediaSize.ISO_A3.asLandscape() : PrintAttributes.MediaSize.ISO_A4);
                    b.setMinMargins(PrintAttributes.Margins.NO_MARGINS);
                    pm.print(title, view.createPrintDocumentAdapter(title), b.build());
                }
            });
            printView = wv;
            wv.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
        });
        call.resolve();
    }
}
