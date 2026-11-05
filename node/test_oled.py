import random
import unittest

try:
    from PIL import Image, ImageDraw
    import oled
except ImportError:
    Image = None


def luma_pack(img):
    """How luma.oled's ssd1306.display() lays a frame out, pixel by pixel: the reference."""
    px = img.load()
    return [bytes(sum(1 << bit for bit in range(8) if px[x, page * 8 + bit]) for x in range(128))
            for page in range(8)]


def scribble(rng):
    img = Image.new("1", (128, 64))
    d = ImageDraw.Draw(img)
    for _ in range(rng.randint(1, 6)):
        x, y = rng.randint(0, 120), rng.randint(0, 56)
        d.rectangle((x, y, x + rng.randint(0, 40), y + rng.randint(0, 30)), fill=rng.randint(0, 1))
    return img


class FakeDevice:
    """Holds what an SSD1306 in horizontal mode would after the same commands."""
    def __init__(self):
        self.ram = [bytearray(128) for _ in range(8)]
        self.window = None
        self.writes = 0

    def command(self, *cmd):
        assert cmd[0] == 0x21 and cmd[3] == 0x22 and cmd[4] == cmd[5]
        self.window = (cmd[4], cmd[1], cmd[2])

    def data(self, data):
        page, x0, x1 = self.window
        assert len(data) == x1 - x0 + 1
        self.ram[page][x0:x1 + 1] = bytes(data)
        self.writes += 1


@unittest.skipUnless(Image, "needs Pillow")
class OledTest(unittest.TestCase):
    def test_packs_the_way_luma_does(self):
        rng = random.Random(1)
        for _ in range(20):
            img = scribble(rng)
            self.assertEqual(oled.pack(img), luma_pack(img))

    def test_unpack_gives_the_picture_back(self):
        img = scribble(random.Random(4))
        again = oled.unpack(oled.pack(img))
        self.assertEqual((again.size, again.tobytes()), (img.size, img.tobytes()))

    def test_one_pixel_is_bit_and_byte_exact(self):
        img = Image.new("1", (128, 64))
        img.putpixel((5, 19), 1)
        pages = oled.pack(img)
        self.assertEqual(pages[2][5], 1 << 3)
        self.assertEqual(sum(map(sum, pages)), 1 << 3)

    def test_no_shadow_sends_everything(self):
        pages = oled.pack(Image.new("1", (128, 64)))
        self.assertEqual(oled.diff(None, pages), [(p, 0, 127) for p in range(8)])

    def test_nothing_changed_sends_nothing(self):
        pages = oled.pack(scribble(random.Random(2)))
        self.assertEqual(oled.diff(pages, list(pages)), [])

    def test_one_changed_byte_is_one_small_window(self):
        a, b = Image.new("1", (128, 64)), Image.new("1", (128, 64))
        b.putpixel((40, 9), 1)
        self.assertEqual(oled.diff(oled.pack(a), oled.pack(b)), [(1, 40, 40)])

    def test_far_apart_changes_are_separate_windows_and_near_ones_join(self):
        a, b = Image.new("1", (128, 64)), Image.new("1", (128, 64))
        for x in (3, 3 + oled.JOIN, 100):
            b.putpixel((x, 0), 1)
        self.assertEqual(oled.diff(oled.pack(a), oled.pack(b)), [(0, 3, 3 + oled.JOIN), (0, 100, 100)])

    def test_the_windows_leave_the_panel_holding_the_new_frame(self):
        rng = random.Random(3)
        dev, shadow = FakeDevice(), None
        for _ in range(40):
            pages = oled.pack(scribble(rng))
            sent = oled.send(dev, pages, oled.diff(shadow, pages))
            self.assertEqual([bytes(row) for row in dev.ram], pages)
            self.assertLessEqual(sent, 1024)
            shadow = pages

    def test_a_small_change_sends_few_bytes(self):
        a = Image.new("1", (128, 64))
        ImageDraw.Draw(a).rectangle((20, 14, 55, 49), fill=1)
        b = a.copy()
        ImageDraw.Draw(b).rectangle((20, 14, 55, 17), fill=0)
        dev = FakeDevice()
        pages = oled.pack(b)
        self.assertEqual(oled.send(dev, pages, oled.diff(oled.pack(a), pages)), 36 * 2)


if __name__ == "__main__":
    unittest.main()
