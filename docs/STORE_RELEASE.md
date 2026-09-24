# Store release checklist

Trailmark ships as `com.mceleste.trailmark` on both platforms. Production
signing keys, passwords, provisioning profiles, and App Store Connect API keys
must stay outside this repository.

## Google Play

1. Create or select Trailmark in Play Console with package name
   `com.mceleste.trailmark`.
2. Create a dedicated upload key and keep its keystore in a password manager or
   encrypted backup. Do not use Android's debug keystore.
3. Configure local release signing and build with
   `android/build-signed-bundle.sh`. The script reads the upload-key password
   from macOS Keychain and keeps all signing secrets outside the repository.
4. Upload the signed AAB and enroll the app in Play App Signing.
5. Complete the store listing, Data safety, content rating, app access, ads,
   target-audience, and location/background-location declarations.
6. Supply Google's background-location declaration, prominent disclosure,
   privacy policy, and short feature-demonstration video.
   The public privacy policy is published at
   `https://mceleste4157.github.io/Trailmark-app/privacy.html`.
   Account-deletion instructions are published at
   `https://mceleste4157.github.io/Trailmark-app/delete-account.html`.
7. Publish to an internal or closed testing track before production. Personal
   developer accounts created after November 13, 2023 currently require 12
   opted-in closed testers for 14 continuous days before production access.

## Apple App Store

1. Add the Apple Developer account to Xcode and select its team for Trailmark.
2. Request Apple's CarPlay Navigation entitlement, accept the CarPlay
   Entitlement Addendum, and wait for Apple to assign the managed capability.
3. Register the explicit App ID `com.mceleste.trailmark` and enable the approved
   CarPlay capability used by `Trailmark.entitlements`.
4. Create the Trailmark record in App Store Connect.
5. Use Xcode automatic signing to archive and upload build 1 of version 1.0.0.
6. Complete App Privacy, age rating, export-compliance, support URL, privacy
   policy URL, description, keywords, and screenshots.
7. Test the uploaded build with TestFlight before submitting it for review.

## Before every upload

- Increment Android `versionCode` and iOS `CURRENT_PROJECT_VERSION`.
- Keep `versionName`, `MARKETING_VERSION`, and the in-app version badge aligned.
- Run Android lint/debug/release builds and an iOS simulator build.
- Test sign-in, location permissions, background navigation, offline maps,
  route loading, crew groups, and account deletion/sign-out behavior.
- Confirm the public privacy policy matches current data collection and sharing.
