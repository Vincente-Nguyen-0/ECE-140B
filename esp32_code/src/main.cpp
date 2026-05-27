#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>
#include "ECE140_WIFI.h"

const char* serverUrl = SERVER_URL_ENV;

ECE140_WIFI wifi;
// Device ID (use unique board MAC address by default)
String deviceId;

// Pins
const int voltagePin = 34; // Analog pin for voltage
const int gpsRxPin = 16;   // GPS RX pin
const int gpsTxPin = 17;   // GPS TX pin

TinyGPSPlus gps;

static const int GPS_BAUD = 9600;
#define gpsSerial Serial2
#define red 5
#define green 6

const unsigned long SEND_INTERVAL = 3000;
unsigned long lastSent = 0;

static char deviceId[18];
static char deviceName[24];

const char* ucsdUsername = UCSD_USERNAME;
String ucsdPassword = String(UCSD_PASSWORD);
const char* wifiSsid = WIFI_SSID;
const char* nonEnterpriseWifiPassword = NON_ENTERPRISE_WIFI_PASSWORD;

void initDeviceIdentity() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  snprintf(deviceId, sizeof(deviceId), "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  snprintf(deviceName, sizeof(deviceName), "ESP %02X:%02X:%02X",
           mac[3], mac[4], mac[5]);
}

void sendGPSData();

void displayLocationInfo() {
  Serial.println(F("-------------------------------------"));
  Serial.println("\n Location Info:");

  Serial.print("Latitude:  ");
  Serial.print(gps.location.lat(), 6);
  Serial.print(" ");
  Serial.println(gps.location.rawLat().negative ? "S" : "N");

  Serial.print("Longitude: ");
  Serial.print(gps.location.lng(), 6);
  Serial.print(" ");
  Serial.println(gps.location.rawLng().negative ? "W" : "E");

  Serial.print("Fix Quality: ");
  Serial.println(gps.location.isValid() ? "Valid" : "Invalid");

  Serial.print("Satellites: ");
  Serial.println(gps.satellites.value());

  Serial.print("Altitude:   ");
  Serial.print(gps.altitude.meters());
  Serial.println(" m");

  Serial.print("Speed:      ");
  Serial.print(gps.speed.kmph());
  Serial.println(" km/h");

  Serial.print("Course:     ");
  Serial.print(gps.course.deg());
  Serial.println("°");

  Serial.print("Date:       ");
  if (gps.date.isValid()) {
    Serial.printf("%02d/%02d/%04d\n", gps.date.day(), gps.date.month(), gps.date.year());
  } else {
    Serial.println("Invalid");
  }

  Serial.print("Time (UTC): ");
  if (gps.time.isValid()) {
    Serial.printf("%02d:%02d:%02d\n", gps.time.hour(), gps.time.minute(), gps.time.second());
  } else {
    Serial.println("Invalid");
  }

  Serial.println(F("-------------------------------------"));
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n[E·Shady] Starting ESP32 Telemetry...");
  
  gpsSerial.begin(9600, SERIAL_8N1, gpsRxPin, gpsTxPin);

  // Use the ESP32 MAC address as a unique device ID.
  // If you want to use a custom unique ID instead, replace this assignment.
  WiFi.mode(WIFI_STA);
  deviceId = WiFi.macAddress();
  deviceId.replace(":", "");
  deviceId.toUpperCase();
  Serial.print("[E·Shady] Device ID: ");
  Serial.println(deviceId);

  Serial.println("Setup done. Connecting WiFi...");
  if (strlen(nonEnterpriseWifiPassword) < 2) {
    wifi.connectToWPAEnterprise(wifiSsid, ucsdUsername, ucsdPassword);
    Serial.println("ucsd");
  } else {
    wifi.connectToWiFi(wifiSsid, nonEnterpriseWifiPassword);
    Serial.println("local");
  }
  delay(2000);

  Serial.println("WiFi connected! IP: " + WiFi.localIP().toString());
  
  Serial.println("[E·Shady] Setup complete");
  delay(500);
  gpsSerial.begin(GPS_BAUD, SERIAL_8N1, 38, 39);
  pinMode(red, OUTPUT);
  pinMode(green, OUTPUT);

  
  initDeviceIdentity();
  Serial.printf("Device ID (MAC): %s  Name: %s\n", deviceId, deviceName);
  Serial.printf("Server URL: %s\n", serverUrl);
}

void loop() {
  while (gpsSerial.available()) {
    if (gps.encode(gpsSerial.read())) {
      displayLocationInfo();
    }
  }

  if (!gps.location.isValid()) {
    digitalWrite(red, HIGH);
    digitalWrite(green, LOW);
  } else {
    digitalWrite(red, LOW);
    digitalWrite(green, HIGH);
  }

  if (millis() > 5000 && gps.charsProcessed() < 10) {
    Serial.println(F("No GPS detected: check wiring."));
    while (true);
  }

  unsigned long now = millis();
  if (now - lastSent >= SEND_INTERVAL) {
    lastSent = now;
    sendGPSData();
  }

  delay(1000);
}

void sendGPSData() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Disconnected – skipping send");
    return;
  }

  char dtBuf[22] = "Invalid";
  if (gps.date.isValid() && gps.time.isValid()) {
    snprintf(dtBuf, sizeof(dtBuf), "%02d/%02d/%04d %02d:%02d:%02d",
             gps.date.day(), gps.date.month(), gps.date.year(),
             gps.time.hour(), gps.time.minute(), gps.time.second());
  }

  JsonDocument doc;
  doc["id"]         = deviceId;
  doc["name"]       = deviceName;
  doc["mac"]        = deviceId;
  doc["latitude"]   = gps.location.isValid() ? gps.location.lat() : 0.0;
  doc["longitude"]  = gps.location.isValid() ? gps.location.lng() : 0.0;
  doc["altitude_m"] = gps.altitude.isValid()  ? gps.altitude.meters() : 0.0;
  doc["speed_kmph"] = gps.speed.isValid()     ? gps.speed.kmph()      : 0.0;
  doc["course_deg"] = gps.course.isValid()    ? gps.course.deg()      : 0.0;
  doc["satellites"] = gps.satellites.isValid() ? (int)gps.satellites.value() : 0;
  doc["fix_valid"]  = gps.location.isValid();
  doc["datetime"]   = dtBuf;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  Serial.printf("[HTTP] POST → %s\n", serverUrl);
  int code = http.POST(body);
  if (code > 0) {
    Serial.printf("[HTTP] Response %d — %s lat=%.6f lng=%.6f\n",
                  code,
                  deviceId,
                  (double)doc["latitude"],
                  (double)doc["longitude"]);
    if (code != 200) {
      Serial.printf("[HTTP] Expected 200 — check server URL ends with /api/gps\n");
    }
  } else {
    Serial.printf("[HTTP] Failed: %s (code %d)\n",
                  http.errorToString(code).c_str(), code);
    Serial.println(F("[HTTP] Tip: use your Mac LAN IP in .env, not 127.0.0.1"));
  }

  http.end();
}