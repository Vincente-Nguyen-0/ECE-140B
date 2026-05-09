# ESP32 Code for E·Shady Telemetry

This folder contains PlatformIO code for Adafruit Feather ESP32-S3 to send voltage and GPS data to the E·Shady backend.

## Setup

1. Install PlatformIO (VS Code extension or CLI)
2. Open this folder in VS Code with PlatformIO
3. Update WiFi credentials:
   - Edit `src/main.cpp` and set `ssid` and `password`
   - Or use environment variables in `.env` file
4. Update `serverUrl` in `src/main.cpp` to your deployed backend URL
5. Build and upload to Adafruit Feather ESP32-S3

## Hardware Requirements

- Adafruit Feather ESP32-S3
- Voltage sensor on analog pin 34 (with voltage divider)
- GPS module on Serial2 (pins 16/17)

## WiFi Connection

Uses `ECE140_WIFI` class which supports:
- Regular WiFi networks (SSID + password)
- WPA Enterprise networks (UCSD WiFi, eduroam, etc.)

## Data Sent

The ESP32 sends JSON data to the backend every 5 seconds:
- Device ID
- Battery % (currently set to 80)
- Charge W (currently set to 50)
- Temperature (currently set to 25.0)
- Voltage (from analog pin)
- Latitude/Longitude (from GPS)

Sends only when GPS has valid location fix.