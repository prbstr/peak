# Mech Suit shopping list

Prices are in ZAR, including VAT. AliExpress 11.11 sale ends **19 Nov, 09:59 (GMT+2)**.

## Orders

| Date | Store | Order | Total | Delivery |
| --- | --- | --- | --- | --- |
| Nov 2026 | AliExpress | — | — | Section 1 |
| 2 Nov 2026 | Communica | #WKZUNXNZL | R1,858.63 (free shipping) | Standard courier, 2–4 working days |

## 1. Core: ordered from AliExpress

- [x] **Geekservo 270°** (Stemedu), with cable 3p, ×6
- [x] **PCA9685 16-channel servo driver**, ×2
- [x] **UBEC 5V 5A** (Anbel), ×1
- [x] **RC UBEC 3A** (U-Angel-1988, output 5.25V ±0.5V, input 5.5–26V), ×1: spare, or for the Pi
- [x] **Mini560 5V buck** (ShengYang), 5V variant, ×2
- [x] **Micro USB male DIY cable**, 2-pin, ×2
- [x] **18650 single-cell holders** (10-pack): use 2, wired in **series**
- [x] **2S 20A BMS**, **Balance Version**, ×1
- [x] **Power switch**: KCD1 2-pin ON-OFF rocker

Still to add on AliExpress if not already ordered:

- [ ] **"Multi-Cell 2S 3S 4S Type-C To 8.4V Step-Up"** charger board, **2S / 8.4V variant**, connected to BMS P+/P−, for charging in place over USB-C. ~R66.50

Power layout:

```
holder 1 (−) ── BMS B−
holder 1 (+) ── holder 2 (−) ── BMS B1/BM   (midpoint)
holder 2 (+) ── BMS B+

BMS P+/P− ─┬─ USB-C 2S charger (battery side of the switch)
           └─ switch ─┬─ UBEC 5V 5A ── PCA9685 V+ ── servos
                      └─ Mini560 5V ── micro-USB pigtail ── Pi 3B
Shared ground between PCA9685 and Pi.
```

Treat ~7.0V on the battery as "low". Below that the Mini560 can't hold 5V for the Pi.

## 2. Ordered from Communica (#WKZUNXNZL, 2 Nov 2026)

- [x] **RASPBERRY PI CAM MODULE 3W ORIG** (Camera Module 3 Wide, 120°, 200mm 15-pin cable), ×1: R856.75
- [x] **INR18650-30HW** 18650 cells, ×4 (two matched pairs; keep each pair together): R540.00
- [x] **BMT ULTRASONIC SENSOR HC-SR04+** (3.3V-safe), ×1: R26.00
- [x] **BMT DIGITAL PIR MOTION SENSOR**, ×1: R22.00
- [x] **BDD I2C 0.96IN OLED 128X64-BLUE** (SSD1306), ×1: R55.00
- [x] **BMT WS2812 NEOPIXEL RING-16 LED**, ×1: R32.00
- [x] **BMT 3 AXIS ACCELEROMETER MPU6050**, ×1: R60.00
- [x] **BMT M20 VIBRATOR MOTOR 1.5-6V**, ×1: R21.00
- [x] **BC337-40** NPN transistor, ×10 (motor driver)
- [x] **1N4148** diode, ×10 (motor flyback)
- [x] **MFR12F-1K0** resistor, ×20 (transistor base)
- [x] **MFR12F-10K** resistor, ×100 (battery divider)
- [x] **MFR12F-4K7** resistor, ×100 (battery divider)
- [x] **HKD FANDC005030-07-RASPBERRY PI4** (5V 30mm fan), ×1: R39.00
- [x] **HKD HEATSINK KIT RASPBERRYPI 3PC**, ×1: R13.00
- [x] **BMT RIBBON JUMPER 40W F/F 15CM**, ×1: R23.00
- [x] **BMT RIBBON JUMPER 40W F/F 30CM**, ×1: R24.00
- [x] **BDD HEAT SHRINK KIT 328PCS 5 COL**, ×1: R55.00

I²C addresses don't clash: PCA9685 0x40, OLED 0x3C, ADS1115 0x48, MPU6050 0x68.

Battery voltage divider:

```
battery + ── 10k ──┬── 4.7k ── GND
                   └── ADS1115 A0   (8.4V full → ~2.7V)
```

Vibrator motor driver:

```
5V ──┬── motor ──┐
     └─ 1N4148 ─┘ (stripe toward 5V)
                 │
           BC337 collector
GPIO ── 1k ── BC337 base
           BC337 emitter ── GND
```

## 3. Still to buy

- [ ] **ADS1115 16-bit ADC**: out of stock at Communica. PiShop has it (R44.90), or add **"ADS1115 16 bit ADC"** to the AliExpress order
- [ ] **Mini USB microphone** (for `node/audiod.sh`): Takealot or a computer shop
- [ ] **Mini USB speaker** (output for `mind/voice`): Takealot or a computer shop
- [ ] **microSD 32GB**: only if the Pi 3B doesn't already have a card with Raspberry Pi OS

## 4. AliExpress: not urgent

- [ ] **"Technic pins axles beams bulk"** (MOC parts mix), 1 bag. ~R200
- [ ] **"servo extension cable 3 pin"**, 15cm and 30cm, ×6. ~R40

## 5. Next body (optional)

- [ ] **Raspberry Pi Zero 2 W** + another PCA9685. Run it with a new `PEAK_NODE=` name.
