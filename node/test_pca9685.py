import unittest
from unittest import mock

import pca9685


class FakeBus:
    def __init__(self):
        self.writes = []

    def write_byte_data(self, addr, reg, value):
        self.writes.append(("byte", addr, reg, value))

    def write_i2c_block_data(self, addr, reg, data):
        self.writes.append(("block", addr, reg, list(data)))


class PCA9685Test(unittest.TestCase):
    def setUp(self):
        self.bus = FakeBus()
        with mock.patch("time.sleep"):
            self.chip = pca9685.PCA9685(address=0x40, frequency=50, bus=self.bus)

    def test_prescale_for_50hz_is_121_and_written_while_asleep(self):
        regs = [(w[2], w[3]) for w in self.bus.writes if w[0] == "byte"]
        self.assertEqual(regs.index((pca9685.PRESCALE, 121)) - regs.index((pca9685.MODE1, pca9685.MODE1_SLEEP)), 1)

    def test_ends_awake_with_restart_and_auto_increment(self):
        self.assertEqual(self.bus.writes[-1], ("byte", 0x40, pca9685.MODE1, 0xA0))

    def test_1500us_is_307_ticks_on_channel_3(self):
        self.bus.writes.clear()
        self.chip.set_pulse_us(3, 1500)
        self.assertEqual(self.bus.writes, [("block", 0x40, 0x06 + 12, [0, 0, 307 & 0xFF, 307 >> 8])])

    def test_pulse_is_clamped_to_the_register_range(self):
        self.bus.writes.clear()
        self.chip.set_pulse_us(0, 1_000_000)
        self.assertEqual(self.bus.writes[0][3], [0, 0, 4095 & 0xFF, 4095 >> 8])

    def test_bad_channel_raises(self):
        with self.assertRaises(ValueError):
            self.chip.set_pulse_us(16, 1500)

    def test_release_zeroes_the_channel(self):
        self.bus.writes.clear()
        self.chip.release(5)
        self.assertEqual(self.bus.writes, [("block", 0x40, 0x06 + 20, [0, 0, 0, 0])])


if __name__ == "__main__":
    unittest.main()
