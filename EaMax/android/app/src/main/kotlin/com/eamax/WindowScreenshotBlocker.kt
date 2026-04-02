package com.eamax

import android.app.Activity
import android.view.WindowManager

/** Bloc ma screenshot na sehemu nyingi za kurekodi skrini (Android [FLAG_SECURE]). */
internal fun Activity.enableScreenshotBlocking() {
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
}
