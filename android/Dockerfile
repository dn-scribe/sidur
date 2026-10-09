# Builds a debug APK without Android Studio.
# Output: app/build/outputs/apk/debug/app-debug.apk
#
# Build the image and extract the APK in one shot:
#
#   docker build -t sidur-apk .
#   docker run --rm -v "$(pwd)/out:/out" sidur-apk \
#       sh -c "cp /build/app/build/outputs/apk/debug/app-debug.apk /out/"
#
# The APK lands at out/app-debug.apk next to this file.

FROM eclipse-temurin:17-jdk-jammy

# ── Android SDK ──────────────────────────────────────────────────────────────
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

RUN apt-get update && apt-get install -y --no-install-recommends wget unzip \
    && rm -rf /var/lib/apt/lists/*

# Command-line tools (revision 11076708 = SDK Tools 2024.1.1)
RUN wget -q -O /tmp/ct.zip \
      "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" \
    && unzip -q /tmp/ct.zip -d /tmp \
    && mkdir -p $ANDROID_HOME/cmdline-tools \
    && mv /tmp/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
    && rm /tmp/ct.zip

RUN yes | sdkmanager --licenses > /dev/null \
    && sdkmanager \
         "platform-tools" \
         "platforms;android-34" \
         "build-tools;34.0.0"

# ── Gradle (no wrapper jar needed) ───────────────────────────────────────────
ENV GRADLE_VERSION=8.4
RUN wget -q -O /tmp/gradle.zip \
      "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" \
    && unzip -q /tmp/gradle.zip -d /opt \
    && rm /tmp/gradle.zip
ENV PATH=$PATH:/opt/gradle-${GRADLE_VERSION}/bin

# ── Build ─────────────────────────────────────────────────────────────────────
WORKDIR /build
COPY . .

RUN gradle assembleDebug --no-daemon --quiet
