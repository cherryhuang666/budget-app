"""
从 app-logo.jpeg 生成各尺寸 PWA 图标。

策略：
- 以脸部中心为基准，做一个正方形 crop（不压缩、不变形）
- crop 后 resize 到目标尺寸（高质量 LANCZOS）

如果以后想调整裁切位置，改 FACE_CY_RATIO 和 CROP_RATIO 即可：
  FACE_CY_RATIO: 脸部中心相对图片高度的位置（0~1）
  CROP_PADDING:  脸两侧留多少空白，0 表示紧贴脸宽，1 表示翻倍留白
"""

from PIL import Image
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'app-logo.jpeg')
OUT_DIR = os.path.join(ROOT, 'assets', 'icons')

SIZES = [72, 96, 128, 144, 152, 192, 384, 512]
APPLE_SIZE = 180  # apple-touch-icon

# 经验值：照片中人头大约从顶部 8% 起，下巴约到 70%
FACE_TOP_RATIO = 0.06    # 头顶起始位置
FACE_BOTTOM_RATIO = 0.78 # 下巴/脖子下方裁切位置


def smart_square_crop(img: Image.Image) -> Image.Image:
    """以头部为中心裁一个正方形。"""
    W, H = img.size

    # 1) 选垂直区间：从头顶到下巴下方
    top = int(H * FACE_TOP_RATIO)
    bottom = int(H * FACE_BOTTOM_RATIO)
    face_h = bottom - top

    # 2) 正方形边长：取垂直区间的高度，但不能超过图片宽度
    size = min(face_h, W)

    # 3) 垂直对齐脸部
    cy = (top + bottom) // 2
    y1 = max(0, cy - size // 2)
    y2 = y1 + size
    if y2 > H:
        y2 = H
        y1 = y2 - size

    # 4) 水平居中
    cx = W // 2
    x1 = max(0, cx - size // 2)
    x2 = x1 + size
    if x2 > W:
        x2 = W
        x1 = x2 - size

    return img.crop((x1, y1, x2, y2))


def main():
    if not os.path.exists(SRC):
        raise SystemExit(f'找不到源图: {SRC}')
    os.makedirs(OUT_DIR, exist_ok=True)

    img = Image.open(SRC).convert('RGB')
    print(f'源图尺寸: {img.size}')

    square = smart_square_crop(img)
    print(f'正方形 crop: {square.size}')

    for s in SIZES:
        resized = square.resize((s, s), Image.LANCZOS)
        out = os.path.join(OUT_DIR, f'icon-{s}.png')
        resized.save(out, optimize=True)
        print(f'  生成 icon-{s}.png')

    apple = square.resize((APPLE_SIZE, APPLE_SIZE), Image.LANCZOS)
    apple_out = os.path.join(OUT_DIR, 'apple-touch-icon.png')
    apple.save(apple_out, optimize=True)
    print(f'  生成 apple-touch-icon.png ({APPLE_SIZE}x{APPLE_SIZE})')

    print('完成。')


if __name__ == '__main__':
    main()
