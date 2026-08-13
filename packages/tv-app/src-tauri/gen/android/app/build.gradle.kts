import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.nasktv.tvapp"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.nasktv.tvapp"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            // release 必须放开明文流量：本应用通过 http://<局域网IP> 连接后端（UDP 广播 / WebSocket / REST 均为明文），
            // defaultConfig 的 usesCleartextTraffic=false 会让 release APK 完全无法访问 http 后端——
            // UDP 发现走原生 Rust 不受 WebView 限制（故能扫到设备），但点击连接的 fetch 与随后的 ws://
            // 会被 Android 明文策略拦截，表现为「扫描到设备却无法连接」。与 debug 对齐放开。
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            // CI 必须签名 release（否则装不上：`INSTALL_PARSE_FAILED_NO_CERTIFICATES`）。
            // 这里复用 debug signingConfig（AGP 自动用 ~/.android/debug.keystore），
            // CI 步骤会用 keytool 提前生成该 keystore。
            // 本地开发者执行过一次 Android 构建（Android Studio 或 gradle）也会自动创建。
            // 上架正式 release 时换成真实 release keystore（参考 signingConfigs.create("release")）。
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")