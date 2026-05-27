#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>
#include "ECE140_WIFI.h"

const char* serverUrl = SERVER_URL_ENV;

ECE140_WIFI wifi;
TinyGPSPlus gps;

static const int GPS_BAUD = 9600;
static const int GPS_RX_PIN = 38;
static const int GPS_TX_PIN = 39;
static const int RED_LED_PIN = 5;
static const int GREEN_LED_PIN = 6;
static const unsigned long SEND_INTERVAL_MS = 3000;

#define gpsSerial Serial2

static unsigned long lastSent = 0;
static unsigned long lastGpsWarning = 0;
static char deviceId[13];
static char deviceName[24];

const char* ucsdUsername = UCSD_USERNAME;
String ucsdPassword = String(UCSD_PASSWORD);
const char* wifiSsid = WIFI_SSID;
const char* nonEnterpriseWifiPassword = NON_ENTERPRISE_WIFI_PASSWORD;

void initDeviceIdentity() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  snprintf(deviceId, sizeof(deviceId), "%02X%02X%02X%02X%02X%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  snprintf(deviceName, sizeof(deviceName), "ESP %02X%02X%02X",
           mac[3], mac[4], mac[5]);
}

void sendGPSData();

void displayLocationInfo() {
  Serial.println(F("-------------------------------------"));
  Serial.println(F("Location Info:"));

  Serial.print(F("Latitude:  "));
  Serial.print(gps.location.lat(), 6);
  Serial.print(F(" "));
  Serial.println(gps.location.rawLat().negative ? "S" : "N");

  Serial.print(F("Longitude: "));
  Serial.print(gps.location.lng(), 6);
  Serial.print(F(" "));
  Serial.println(gps.location.rawLng().negative ? "W" : "E");

  Serial.print(F("Fix Quality: "));
  Serial.println(gps.location.isValid() ? "Valid" : "Invalid");

  Serial.print(F("Satellites: "));
  Serial.println(gps.satellites.value());

  Serial.print(F("Altitude:   "));
  Serial.print(gps.altitude.meters());
  Serial.println(F(" m"));

  Serial.print(F("Speed:      "));
  Serial.print(gps.speed.kmph());
  Serial.println(F(" km/h"));

  Serial.print(F("Course:     "));
  Serial.print(gps.course.deg());
  Serial.println(F(" deg"));

  Serial.print(F("Date:       "));
  if (gps.date.isValid()) {
    Serial.printf("%02d/%02d/%04d\n", gps.date.day(), gps.date.month(), gps.date.year());
  } else {
    Serial.println(F("Invalid"));
  }

  Serial.print(F("Time (UTC): "));
  if (gps.time.isValid()) {
    Serial.printf("%02d:%02d:%02d\n", gps.time.hour(), gps.time.minute(), gps.time.second());
  } else {
    Serial.println(F("Invalid"));
  }

  Serial.println(F("-------------------------------------"));
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println(F("[E-Shady] Starting ESP32 GPS telemetry"));

  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);

  WiFi.mode(WIFI_STA);
  initDeviceIdentity();
  Serial.printf("[E-Shady] Device ID (MAC): %s  Name: %s\n", deviceId, deviceName);
  Serial.printf("[E-Shady] Server URL: %s\n", serverUrl);

  if (strlen(nonEnterpriseWifiPassword) < 2) {
    wifi.connectToWPAEnterprise(wifiSsid, ucsdUsername, ucsdPassword);
    Serial.println(F("[WiFi] Connected using WPA Enterprise"));
  } else {
    wifi.connectToWiFi(wifiSsid, nonEnterpriseWifiPassword);
    Serial.println(F("[WiFi] Connected using local WiFi"));
  }

  delay(2000);
  Serial.println("WiFi connected. IP: " + WiFi.localIP().toString());
}

void loop() {
  while (gpsSerial.available()) {
    if (gps.encode(gpsSerial.read())) {
      displayLocationInfo();
    }
  }

  if (!gps.location.isValid()) {
    digitalWrite(RED_LED_PIN, HIGH);
    digitalWrite(GREEN_LED_PIN, LOW);
  } else {
    digitalWrite(RED_LED_PIN, LOW);
    digitalWrite(GREEN_LED_PIN, HIGH);
  }

  if (millis() > 5000 && gps.charsProcessed() < 10 && millis() - lastGpsWarning > 5000) {
    Serial.println(F("[GPS] No GPS data yet; check wiring if this continues."));
    lastGpsWarning = millis();
  }

  unsigned long now = millis();
  if (now - lastSent >= SEND_INTERVAL_MS) {
    lastSent = now;
    sendGPSData();
  }

  delay(100);
}

void sendGPSData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[WiFi] Disconnected; skipping send"));
    return;
  }

  char dtBuf[22] = "Invalid";
  if (gps.date.isValid() && gps.time.isValid()) {
    snprintf(dtBuf, sizeof(dtBuf), "%02d/%02d/%04d %02d:%02d:%02d",
             gps.date.day(), gps.date.month(), gps.date.year(),
             gps.time.hour(), gps.time.minute(), gps.time.second());
  }

  JsonDocument doc;
  doc["id"] = deviceId;
  doc["name"] = deviceName;
  doc["mac"] = deviceId;
  doc["latitude"] = gps.location.isValid() ? gps.location.lat() : 0.0;
  doc["longitude"] = gps.location.isValid() ? gps.location.lng() : 0.0;
  doc["altitude_m"] = gps.altitude.isValid() ? gps.altitude.meters() : 0.0;
  doc["speed_kmph"] = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
  doc["course_deg"] = gps.course.isValid() ? gps.course.deg() : 0.0;
  doc["satellites"] = gps.satellites.isValid() ? (int)gps.satellites.value() : 0;
  doc["fix_valid"] = gps.location.isValid();
  doc["datetime"] = dtBuf;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  Serial.printf("[HTTP] POST %s\n", serverUrl);
  int code = http.POST(body);
  if (code > 0) {
    Serial.printf("[HTTP] Response %d - %s lat=%.6f lng=%.6f\n",
                  code,
                  deviceId,
                  (double)doc["latitude"],
                  (double)doc["longitude"]);
    if (code != 200) {
      Serial.println(F("[HTTP] Expected 200; check that SERVER_URL_ENV ends with /api/gps"));
    }
  } else {
    Serial.printf("[HTTP] Failed: %s (code %d)\n", http.errorToString(code).c_str(), code);
    Serial.println(F("[HTTP] Tip: use the server LAN IP, not 127.0.0.1, when running locally."));
  }

  http.end();
}
