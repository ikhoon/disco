// make-icon.swift — disco app icon in the mac* family style: a dark terminal
// window (traffic-light dots top-left) with a big glyph, like macmail's @ and
// maccal's calendar. Here the glyph is a chat bubble in Discord blurple, so the
// icon reads as "Discord, from the terminal" at a glance.
// Usage: swift make-icon.swift <out.iconset-dir>
import AppKit

func c(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat) -> NSColor {
    NSColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: 1)
}

/// An SF Symbol filled with a solid color.
func tintedSymbol(_ name: String, pointSize: CGFloat, weight: NSFont.Weight, color: NSColor) -> NSImage? {
    let cfg = NSImage.SymbolConfiguration(pointSize: pointSize, weight: weight)
    guard let sym = NSImage(systemSymbolName: name, accessibilityDescription: nil)?
        .withSymbolConfiguration(cfg) else { return nil }
    let g = sym.size
    let out = NSImage(size: g)
    out.lockFocus()
    color.setFill(); NSRect(origin: .zero, size: g).fill()
    sym.draw(at: .zero, from: NSRect(origin: .zero, size: g), operation: .destinationIn, fraction: 1)
    out.unlockFocus()
    return out
}

func drawIcon(_ px: CGFloat) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(px), pixelsHigh: Int(px),
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .calibratedRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: px, height: px)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSGraphicsContext.current?.imageInterpolation = .high

    let full = NSRect(x: 0, y: 0, width: px, height: px)
    let body = full.insetBy(dx: px * 0.085, dy: px * 0.085)
    let corner = body.width * 0.2237
    let path = NSBezierPath(roundedRect: body, xRadius: corner, yRadius: corner)

    // dark "terminal window" gradient (top lighter → bottom near-black)
    NSGraphicsContext.current?.saveGraphicsState()
    path.addClip()
    NSGradient(colors: [c(60, 60, 63), c(22, 22, 24)])!.draw(in: body, angle: -90)
    NSGraphicsContext.current?.restoreGraphicsState()

    // traffic-light dots, top-left (window controls)
    let r = px * 0.026
    let dy = body.maxY - px * 0.105
    let x0 = body.minX + px * 0.105
    let gap = px * 0.082
    for (i, col) in [c(255, 95, 87), c(254, 188, 46), c(40, 200, 64)].enumerated() {
        col.setFill()
        NSBezierPath(ovalIn: NSRect(x: x0 + CGFloat(i) * gap - r, y: dy - r, width: r * 2, height: r * 2)).fill()
    }

    // big chat-bubble glyph in Discord blurple, centred (nudged down for the title bar)
    let blurple = c(88, 101, 242) // Discord #5865F2
    if let bubble = tintedSymbol("bubble.left.and.bubble.right.fill", pointSize: px * 0.46, weight: .semibold, color: blurple) {
        let g = bubble.size
        bubble.draw(in: NSRect(x: (px - g.width) / 2, y: (px - g.height) / 2 - px * 0.03,
                               width: g.width, height: g.height))
    }
    NSGraphicsContext.restoreGraphicsState()
    return rep
}

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset"
let specs: [(String, Int)] = [
    ("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64),
    ("128x128", 128), ("128x128@2x", 256), ("256x256", 256), ("256x256@2x", 512),
    ("512x512", 512), ("512x512@2x", 1024),
]
for (name, px) in specs {
    let rep = drawIcon(CGFloat(px))
    let data = rep.representation(using: .png, properties: [:])!
    try! data.write(to: URL(fileURLWithPath: "\(outDir)/icon_\(name).png"))
}
print("wrote \(specs.count) PNGs to \(outDir)")
