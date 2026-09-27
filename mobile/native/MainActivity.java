package fr.electricad.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Activité principale : enregistre le module natif (fichiers, impression) avant la
// création du pont Capacitor
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeFiles.class);
        super.onCreate(savedInstanceState);
    }
}
