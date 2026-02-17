# Streaming Apps Setup Guide

This React Native app includes two streaming applications: Football (GoalStream) and Movies (StreamFlix).

## Installation

1. Install dependencies:
```bash
npm install
```

2. Link vector icons fonts (IMPORTANT for icons to display):
```bash
npx react-native-asset
```

Or manually link fonts:
```bash
# Copy fonts to Android
cp -r node_modules/react-native-vector-icons/Fonts/* android/app/src/main/assets/fonts/

# For iOS
cd ios && pod install && cd ..
```

3. Rebuild the app:
```bash
# Clean and rebuild
cd android && ./gradlew clean && cd ..
npm run android
```

## Running the App

### Android
```bash
npm run android
```

### iOS
```bash
npm run ios
```

## Features

- **App Switcher**: Toggle between Football and Movies apps
- **Premium Toggle**: Switch between Free and Premium user modes
- **Points System**: Earn points by watching ads (Free users)
- **Ad Modal**: Watch ads to earn points and unlock streaming
- **Live Matches**: View live football matches and upcoming games
- **Movie Streaming**: Browse trending movies and genres

## Components Structure

- `App.js` - Main entry point
- `src/components/StreamingApp.js` - Main container with app switcher
- `src/components/FootballApp.js` - Football streaming interface
- `src/components/MoviesApp.js` - Movies streaming interface
- `src/components/AdModal.js` - Ad watching modal

## Dependencies

- `react-native-vector-icons` - For icons
- `react-native-linear-gradient` - For gradient backgrounds
- `react-native-safe-area-context` - For safe area handling

## Notes

- The app uses a dark theme with green accents for Football and purple accents for Movies
- Premium users can stream directly without watching ads
- Free users need to watch ads to earn points and unlock streaming
- Points are shared across both apps
