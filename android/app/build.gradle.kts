import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val uploadStoreFile = providers.environmentVariable("TRAILMARK_UPLOAD_STORE_FILE").orNull
val uploadStorePassword = providers.environmentVariable("TRAILMARK_UPLOAD_STORE_PASSWORD").orNull
val uploadKeyAlias = providers.environmentVariable("TRAILMARK_UPLOAD_KEY_ALIAS").orNull
val uploadKeyPassword = providers.environmentVariable("TRAILMARK_UPLOAD_KEY_PASSWORD").orNull

android {
    namespace = "com.mceleste.trailmark"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.mceleste.trailmark"
        minSdk = 23
        targetSdk = 36
        versionCode = 2
        versionName = "1.0.1"
    }

    buildFeatures {
        buildConfig = true
    }

    if (
        uploadStoreFile != null &&
        uploadStorePassword != null &&
        uploadKeyAlias != null &&
        uploadKeyPassword != null
    ) {
        signingConfigs {
            create("release") {
                storeFile = file(uploadStoreFile)
                storePassword = uploadStorePassword
                keyAlias = uploadKeyAlias
                keyPassword = uploadKeyPassword
            }
        }

        buildTypes {
            getByName("release") {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_1_8)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.car.app:app:1.7.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.maplibre.gl:android-sdk:13.6.1")
}
