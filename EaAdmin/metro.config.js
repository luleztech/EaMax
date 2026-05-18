const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { wrapWithReanimatedMetroConfig } = require('react-native-reanimated/metro-config');

const reanimatedMain = path.resolve(
  __dirname,
  'node_modules/react-native-reanimated/lib/module/index.js',
);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'react-native-reanimated') {
        return { type: 'sourceFile', filePath: reanimatedMain };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = wrapWithReanimatedMetroConfig(
  mergeConfig(getDefaultConfig(__dirname), config),
);
