# Android Apps

В проекте две версии Android-приложения:

| Папка | Описание |
|-------|----------|
| `android/` | Фиксированный адрес `https://cosmogram.rupru.ru` |
| `android_all/` | С диалогом ввода любого адреса при старте |

Обе версии это WebView-обёртки над веб-интерфейсом Cosmogram.

---

## 🔧 Сборка

```bash
# Требования:
#   Java 17 (JAVA_HOME)
#   Android SDK (/usr/lib/android-sdk)

# Версия с фиксированным адресом
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk

# Версия с выбором адреса
cd android_all && ./gradlew assembleDebug
# APK: android_all/app/build/outputs/apk/debug/app-debug.apk
```

### Release-сборка (подписанный APK)

```bash
# Подписанные release APK уже в корне проекта:
#   cosmogram.apk      — android/ (фиксированный адрес)
#   cosmogram_all.apk  — android_all/ (выбор адреса)

# Пересобрать вручную:
cd android && ./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../../cosmogram.apk
```

Подпись release-версий:
- Keystore: `android/cosmogram-release.keystore` (alias `cosmogram`)
- Пароль: в `android/keystore.properties` (файл в `.gitignore` — не коммитить!)
- R8/ProGuard минификация включена (`minifyEnabled true`)

> ⚠️ Keystore и `keystore.properties` — секреты. Потеря keystore = невозможность обновлять приложение под тем же ключом. Храните их в надёжном месте.

---

## 📱 Возможности

- **WebView** с JavaScript, DOM Storage, куками
- **Pull-to-refresh** — свайп вниз для обновления
- **Навигация назад** — кнопка Back по истории WebView
- **ProgressBar** — индикатор загрузки вверху экрана
- **Camera + Storage permissions** — запрос при первом запуске
- **Тёмная тема** — StatusBar и NavBar цвета #1A1A2E

### android_all (с выбором адреса)

- Диалог ввода URL при запуске
- Адрес сохраняется в `SharedPreferences`
- Кнопка **Defaults** для сброса на `https://cosmogram.rupru.ru`
- Разрешён cleartext HTTP для локальных серверов

### android (фиксированный адрес)

- Открывает `https://cosmogram.rupru.ru` сразу без диалога
- Cleartext HTTP запрещён

---

## 📂 Структура

```
android*/                    # android/ или android_all/
├── build.gradle             # Корневой Gradle (AGP 8.2.0)
├── settings.gradle
├── gradle.properties
├── local.properties         # sdk.dir
├── gradlew
├── gradle/wrapper/
│   ├── gradle-wrapper.jar
│   └── gradle-wrapper.properties   # Gradle 8.2
└── app/
    ├── build.gradle         # minSdk 24, targetSdk 34
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/com/cosmogram/app/
        │   └── MainActivity.java
        └── res/
            ├── layout/
            │   ├── activity_main.xml       # WebView + SwipeRefresh + ProgressBar
            │   └── dialog_server_url.xml   # (только android_all)
            ├── values/
            │   ├── strings.xml
            │   └── themes.xml
            ├── xml/
            │   └── network_security_config.xml   # (только android_all)
            └── mipmap-*/ic_launcher.png
```

---

## 🔐 Permissions

| Permission | Назначение |
|------------|------------|
| `INTERNET` | Доступ к серверу |
| `CAMERA` | Съёмка фото/видео из браузера |
| `READ_EXTERNAL_STORAGE` | (Android ≤12) Чтение галереи |
| `READ_MEDIA_IMAGES` | (Android 13+) Чтение изображений |
| `READ_MEDIA_VIDEO` | (Android 13+) Чтение видео |

---

## ⚙️ Кастомизация

В `MainActivity` измените константу:

```java
private static final String DEFAULT_URL = "https://ваш-сервер.ру";
```

Для `android/` — это единственный адрес. Для `android_all/` — адрес по умолчанию в диалоге.

---

## 📦 Установка

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
# или просто открыть APK-файл на устройстве
```
