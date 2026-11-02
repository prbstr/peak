"""Minimal PCA9685 16-channel PWM driver over smbus2.

Replaces adafruit_servokit, whose Blinka dependency does not build on a Pi 3B.
The bus is injectable so the register writes can be tested without hardware.
"""
import time

MODE1 = 0x00
MODE2 = 0x01
PRESCALE = 0xFE
LED0_ON_L = 0x06

MODE1_SLEEP = 0x10
MODE1_AUTO_INCREMENT = 0x20
MODE1_RESTART = 0x80
MODE2_TOTEM_POLE = 0x04

OSC_HZ = 25_000_000
STEPS = 4096


class PCA9685:
    def __init__(self, address=0x40, frequency=50, bus=None):
        if bus is None:
            from smbus2 import SMBus
            bus = SMBus(1)
        self.bus = bus
        self.address = address
        self.frequency = frequency
        self._configure()

    def _configure(self):
        prescale = round(OSC_HZ / (STEPS * self.frequency)) - 1
        self.bus.write_byte_data(self.address, MODE2, MODE2_TOTEM_POLE)
        self.bus.write_byte_data(self.address, MODE1, MODE1_SLEEP)  # prescale only changes while asleep
        self.bus.write_byte_data(self.address, PRESCALE, prescale)
        self.bus.write_byte_data(self.address, MODE1, MODE1_AUTO_INCREMENT)
        time.sleep(0.005)  # oscillator needs 500 us to settle
        self.bus.write_byte_data(self.address, MODE1, MODE1_AUTO_INCREMENT | MODE1_RESTART)

    def set_pulse_us(self, channel, microseconds):
        if not 0 <= channel <= 15:
            raise ValueError(f"channel {channel} out of range 0-15")
        ticks = round(microseconds * STEPS * self.frequency / 1_000_000)
        ticks = max(0, min(STEPS - 1, ticks))
        self.bus.write_i2c_block_data(
            self.address, LED0_ON_L + 4 * channel,
            [0, 0, ticks & 0xFF, ticks >> 8],
        )

    def release(self, channel):
        """Stop driving a channel so the servo goes limp."""
        self.bus.write_i2c_block_data(self.address, LED0_ON_L + 4 * channel, [0, 0, 0, 0])
