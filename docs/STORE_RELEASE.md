# Store release checklist

Trailmark ships as `com.mceleste.trailmark` on both platforms. Production
signing keys, passwords, provisioning profiles, and App Store Connect API keys
must stay outside this repository.

## Google Play

1. Create or select Trailmark in Play Console with package name
   `com.mceleste.trailmark`.
2. Create a dedicated upload key and keep its keystore in a password manager or
   encrypted backup. Do not use Android's debug keystore.
3. Configure local release signing and build with `./gradlew bundleRelease`.
4. Upload the signed AAB and enroll the app in Play App Signing.
5. Complete the store listing, Data safety, content rating, app access, ads,
   target-audience, and location/background-location declarations.
6. Publish to an internal or closed testing track before production.

## Apple App Store

1. Add the Apple Developer account to Xcode and select its team for Trailmark.
2. Register the explicit App ID `com.mceleste.trailmark`. Enable only the
   capabilities used by the checked-in entitlements.
3. Create the Trailmark record in App Store Connect.
4. Use Xcode automatic signing to archive and upload build 1 of version 1.0.0.
5. Complete App Privacy, age rating, export-compliance, support URL, privacy
   policy URL, description, keywords, and screenshots.
6. Test the uploaded build with TestFlight before submitting it for review.

## Before every upload

- Increment Android `versionCode` and iOS `CURRENT_PROJECT_VERSION`.
- Keep `versionName`, `MARKETING_VERSION`, and the in-app version badge aligned.
- Run Android lint/debug/release builds and an iOS simulator build.
- Test sign-in, location permissions, background navigation, offline maps,
  route loading, crew groups, and account deletion/sign-out behavior.
- Confirm the public privacy policy matches current data collection and sharing.
