package com.eamax.player

import android.content.Context
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.platform.PlatformView
import io.flutter.plugin.platform.PlatformViewFactory

class GatewayWebPlayerFactory(
    private val messenger: BinaryMessenger,
) : PlatformViewFactory(StandardMessageCodec.INSTANCE) {

    @Suppress("UNCHECKED_CAST")
    override fun create(context: Context, viewId: Int, args: Any?): PlatformView {
        val params = (args as? Map<String, Any?>) ?: emptyMap()
        return GatewayWebPlayerPlatformView(context, viewId, params, messenger)
    }
}
