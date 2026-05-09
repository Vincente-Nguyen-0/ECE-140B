# ESP32 Code for E·Shady Telemetry

This folder contains PlatformIO code for ESP32 to send voltage and GPS data to the E·Shady backend.

## Setup

1. Install PlatformIO (VS Code extension or CLI)
2. Open this folder in VS Code with PlatformIO
3. Update WiFi credentials in `src/main.cpp`
4. Update `serverUrl` to your deployed backend URL
5. Build and upload to ESP32

## Hardware Requirements

- ESP32 board
- Voltage sensor on analog pin 34 (with voltage divider)
- GPS module on Serial2 (pins 16/17)

## Data Sent

- Device ID
- Battery % (placeholder: 80)
- Charge W (placeholder: 50)
- Temperature (placeholder: 25.0)
- Voltage (from analog pin)
- Latitude/Longitude (from GPS)

Sends every 5 seconds when GPS is valid.