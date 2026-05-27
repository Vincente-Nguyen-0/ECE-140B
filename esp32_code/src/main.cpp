#include <Arduino.h>
#include <HTTPClient.h>
#include <TinyGPS++.h>
#include "ECE140_WIFI.h"

// WiFi credentials (set via .env)
String ssid = "YOUR_SSID";
String password = "YOUR_PASSWORD";

// Backend URL
const char* serverUrl = "https://your-render-app.onrender.com/api/esp32/telemetry";

// Device ID (use unique board MAC address by default)
String deviceId;

// Pins
const int voltagePin = 34; // Analog pin for voltage
const int gpsRxPin = 16;   // GPS RX pin
const int gpsTxPin = 17;   // GPS TX pin

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
ECE140_WIFI wifiManager;

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

  // Connect to WiFi
  wifiManager.connectToWiFi(ssid, password);
  
  Serial.println("[E·Shady] Setup complete");
}

void loop() {
  // Read voltage
  int adcValue = analogRead(voltagePin);
  float voltage = (adcValue / 4095.0) * 3.3 * 2; // Assuming voltage divider

  // Read GPS
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  if (gps.location.isValid()) {
    float latitude = gps.location.lat();
    float longitude = gps.location.lng();

    // Send data
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(serverUrl);
      http.addHeader("Content-Type", "application/json");

      String jsonData = "{";
      jsonData += "\"device_id\":\"" + String(deviceId) + "\",";
      jsonData += "\"battery_pct\":80,";
      jsonData += "\"charge_w\":50,";
      jsonData += "\"temperature\":25.0,";
      jsonData += "\"voltage\":" + String(voltage, 2) + ",";
      jsonData += "\"latitude\":" + String(latitude, 6) + ",";
      jsonData += "\"longitude\":" + String(longitude, 6);
      jsonData += "}";

      int httpResponseCode = http.POST(jsonData);
      if (httpResponseCode > 0) {
        Serial.print("[E·Shady] Data sent successfully (");
        Serial.print(httpResponseCode);
        Serial.println(")");
      } else {
        Serial.print("[E·Shady] Error sending data: ");
        Serial.println(http.errorToString(httpResponseCode));
      }
      http.end();
    } else {
      Serial.println("[E·Shady] WiFi disconnected, attempting to reconnect...");
      wifiManager.connectToWiFi(ssid, password);
    }
  } else {
    Serial.println("[E·Shady] Waiting for GPS lock...");
  }

  delay(5000); // Send every 5 seconds
}