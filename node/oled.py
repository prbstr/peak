"""peak node — getting a picture onto an SSD1306 quickly.

luma.oled sends the whole 128x64 frame every time, about 0.1 s on the Pi's 100 kHz I2C bus, after packing
it pixel by pixel in Python. Eyes that blink need better: this packs with PIL in C, keeps a copy of what
the panel holds, and sends only the bytes that changed.

The panel's memory is eight pages, each a row of bytes one per column, bit 0 the top pixel of the page.
"""
from PIL import Image

PAGES = 8
JOIN = 12  # changed bytes this close together go in one window: opening a window costs about that many bytes
BIT_REVERSED = bytes(int(f"{b:08b}"[::-1], 2) for b in range(256))

def pack(img):
    """A 128x64 mode "1" image as the panel's pages. Transposed, each of PIL's rows is one column of the
    screen, eight bytes top to bottom, most significant bit first: the panel wants the other bit order."""
    columns = img.transpose(Image.Transpose.TRANSPOSE).tobytes().translate(BIT_REVERSED)
    return [columns[p::PAGES] for p in range(PAGES)]

def diff(shadow, pages):
    """The windows to send, as (page, first column, last column). With no shadow, everything."""
    if shadow is None:
        return [(p, 0, len(row) - 1) for p, row in enumerate(pages)]
    runs = []
    for p, (old, new) in enumerate(zip(shadow, pages)):
        if old == new:
            continue
        start = last = None
        for x in range(len(new)):
            if old[x] == new[x]:
                continue
            if start is None:
                start = x
            elif x - last > JOIN:
                runs.append((p, start, last))
                start = x
            last = x
        runs.append((p, start, last))
    return runs

def send(dev, pages, runs):
    """Write the windows to a luma ssd1306 device. Returns the bytes of picture sent."""
    sent = 0
    for p, x0, x1 in runs:
        dev.command(0x21, x0, x1, 0x22, p, p)  # column window, page window
        dev.data(list(pages[p][x0:x1 + 1]))
        sent += x1 - x0 + 1
    return sent
