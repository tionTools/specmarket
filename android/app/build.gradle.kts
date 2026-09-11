plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val releaseStorePath = providers.environmentVariable("ORDERS_RELEASE_STORE_FILE").orNull
val releaseStorePass = providers.environmentVariable("ORDERS_RELEASE_STORE_PASS").orNull
val releaseAlias = providers.environmentVariable("ORDERS_RELEASE_ALIAS").orNull
val releaseKeyPass = providers.environmentVariable("ORDERS_RELEASE_KEY_PASS").orNull
val releaseSigningReady = listOf(releaseStorePath, releaseStorePass, releaseAlias, releaseKeyPass)
    .all { !it.isNullOrBlank() }

android {
    namespace = "ua.orders.crm"
    compileSdk = 37
    defaultConfig {
        applicationId = "ua.orders.crm"
        minSdk = 26
        targetSdk = 36
        versionCode = 9
        versionName = "0.9"
    }
    signingConfigs {
        create("release") {
            if (releaseSigningReady) {
                storeFile = file(releaseStorePath!!)
                storePassword = releaseStorePass!!
                keyAlias = releaseAlias!!
                keyPassword = releaseKeyPass!!
            }
        }
    }
    buildTypes {
        getByName("release") {
            if (releaseSigningReady) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.08.00")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.foundation:foundation")
    implementation(platform("io.github.jan-tennert.supabase:bom:3.6.0"))
    implementation("io.github.jan-tennert.supabase:auth-kt")
    implementation("io.github.jan-tennert.supabase:postgrest-kt")
    implementation("io.github.jan-tennert.supabase:realtime-kt")
    implementation("io.github.jan-tennert.supabase:functions-kt")
    implementation("io.ktor:ktor-client-okhttp:3.4.3")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.datastore:datastore-preferences:1.2.0")
    testImplementation("junit:junit:4.13.2")
}
