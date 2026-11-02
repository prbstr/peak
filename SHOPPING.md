# Mech Suit shopping list (AliExpress)

Prices are rough ZAR estimates. 11.11 sale ends **19 Nov, 09:59 (GMT+2)**.

## 1. Core

- [ ] **"Geekservo 270 degree"** (Stemedu): variant **with cable 3p**. Qty 6 (4-pack + 2 singles). ~R540
- [ ] **"PCA9685 16 channel servo driver"**: blue board, I²C. Qty 2 (1 spare). ~R80
- [ ] **"UBEC 5V 5A"** (Anbel listing): **5V output, 5A** variant. Qty 1. ~R60
- [ ] **"Mini560 5V buck"** or "5V 3A mini buck module": **5V fixed**, powers the Pi. Qty 2. ~R40
- [ ] **"micro USB male DIY cable"**: 2-wire pigtail. Qty 2. ~R20
- [ ] **"2S 18650 battery holder"** with wires. Qty 1. ~R25
- [ ] **"2S BMS 7.4V"**. Qty 1. ~R25
- [ ] **"mini rocker switch"** or "XT30 pigtail". Qty 1. ~R20

Power layout:

```
2S battery ─┬─ UBEC 5V 5A ── PCA9685 V+ ── servos
            └─ Mini560 5V ── micro-USB pigtail ── Pi 3B
Shared ground between PCA9685 and Pi.
```

## 2. Senses and voice

- [ ] **"OV5647 Raspberry Pi camera 160 degree wide angle"**: works with `rpicam-vid` in `node/camd.sh`. Qty 1. ~R120
- [ ] **"Raspberry Pi camera cable 30cm"**: camera in the head, Pi in the backpack. Qty 1. ~R30
- [ ] **"mini USB microphone Raspberry Pi"**: for `node/audiod.sh`. Qty 1. ~R30
- [ ] **"mini USB speaker Raspberry Pi"**: output for `mind/voice`. Qty 1. ~R80
- [ ] **"ADS1115 16 bit ADC"**: feeds the `battery` field in `contracts/sense.schema.json`. Qty 1. ~R40
- [ ] **"voltage divider sensor module 0-25V"**: battery voltage into the ADS1115. Qty 1. ~R20
- [ ] **"RCWL-1601 ultrasonic"**: 3.3V-safe HC-SR04 replacement on GPIO 23/24. Qty 1. ~R25

## 3. Looks

- [ ] **"SSD1306 0.96 OLED I2C"**: face or status display. Qty 1. ~R40
- [ ] **"WS2812B ring 12 LED"**: eye or reactor light. Qty 1. ~R30
- [ ] **"GY-521 MPU6050"**: knocked-over / picked-up detection. Qty 1. ~R30
- [ ] **"Raspberry Pi 3B heatsink"** + **"30mm 5V fan"**. Qty 1 set. ~R40

I²C addresses don't clash: PCA9685 0x40, OLED 0x3C, ADS1115 0x48, MPU6050 0x68.

## 4. Build supplies

- [ ] **"Technic pins axles beams bulk"** (MOC parts mix). Qty 1 bag. ~R200
- [ ] **"servo extension cable 3 pin"**, 15cm and 30cm. Qty 6. ~R40
- [ ] **"dupont jumper wire kit"** F-F / M-F. Qty 1. ~R40
- [ ] **"heat shrink assortment"**. Qty 1. ~R30

**Rough total for 1–4: ~R1,600**

## 5. Next body (optional)

- [ ] **"Raspberry Pi Zero 2 W"** + another PCA9685. Run it with a new `PEAK_NODE=` name.

## Buy locally, not on AliExpress

- [ ] 2 × 18650 cells (reputable brand, flat-top or button-top to match the holder)
- [ ] 18650 charger
- [ ] microSD card, 32 GB
