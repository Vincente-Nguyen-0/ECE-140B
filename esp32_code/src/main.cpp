#include <WiFi.h>
#include <HTTPClient.h>
#include <TinyGPS++.h>

// WiFi credentials
const char* ssid = "YOUR_SSID";
const char* password = "YOUR_PASSWORD";

// Backend URL
const char* serverUrl = "https://your-render-app.onrender.com/api/esp32/telemetry";

// Device ID
const char* deviceId = "esp32_001";

// Pins
const int voltagePin = 34; // Analog pin for voltage
const int gpsRxPin = 16;   // GPS RX pin
const int gpsTxPin = 17;   // GPS TX pin

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600, SERIAL_8N1, gpsRxPin, gpsTxPin);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(1000);
  }
  Serial.println("Connected to WiFi");
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
      jsonData += "\"voltage\":" + String(voltage) + ",";
      jsonData += "\"latitude\":" + String(latitude) + ",";
      jsonData += "\"longitude\":" + String(longitude);
      jsonData += "}";

      int httpResponseCode = http.POST(jsonData);
      if (httpResponseCode > 0) {
        Serial.println("Data sent successfully");
      } else {
        Serial.println("Error sending data");
      }
      http.end();
    }
  }

  delay(5000); // Send every 5 seconds
}