#!/usr/bin/env node
// Fix react-native-keep-awake Android build: replace deprecated jcenter() with mavenCentral()
const fs = require('fs');
const path = require('path');

const buildGradle = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-keep-awake',
  'android',
  'build.gradle'
);

try {
  if (fs.existsSync(buildGradle)) {
    let content = fs.readFileSync(buildGradle, 'utf8');
    if (content.includes('jcenter()')) {
      content = content.replace(/\bjcenter()\b/g, 'mavenCentral()');
      fs.writeFileSync(buildGradle, content);
    }
  }
} catch (_) {}
