"""Keyframe stills for the master film (docs/content/scripts/master-film.md).

Each still is an edit of reference images (Maya, the kitchen, the drawing, the
painting, Violet) so the same girl appears every time. Runs shots in parallel.
usage: CONTENT_WORK=<work dir> python keyframes.py outdir [shot ...]
"""
import base64, concurrent.futures as cf, json, os, subprocess, sys

# The working folder that holds child/, violet/ and v_alpha/ (see docs/content/README.md).
S = os.environ.get("CONTENT_WORK", ".")
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
MAYA = f"{S}/child/facetime.png"        # the girl, kitchen
DRAW = f"{S}/violet/original.jpg"       # Maya's drawing
PAINT = f"{S}/violet/rendered.png"      # the painting HeroMaker made
VIOLET = f"{S}/v_alpha/0040.png"         # Violet in 3D (our render)

LOOK = ("A still frame from a video a parent films on a phone at home, 16:9. Natural, "
        "lived-in, a little messy and imperfect, real daylight, nothing staged or glossy, "
        "slight handheld angle. The girl is EXACTLY the girl in the first reference image "
        "(same face, hair in two pigtails, yellow t-shirt and blue jeans: one outfit in every shot), about 7 years old. No text, no logos, "
        "no app interface text.")

SHOTS = {
    "1.1": ([MAYA, DRAW], "Tight close-up from the girl's own side of the table, looking down over her hand: the crayon drawing from the second reference image lies UPRIGHT for her (its head away from her, its boots nearest her hand), and her small hand with a pink crayon fills in a pink boot. The boot fills much of the frame. Only her hand and the paper."),
    "1.2": ([MAYA, DRAW], "Over her shoulder, from behind and slightly above: she bends over the drawing from the second reference image, which lies UPRIGHT for her (its head away from her, its feet towards her), colouring the yellow cape, absorbed, not looking at the camera. We see the back of her head, her pigtails and the drawing the right way up. Breakfast plates pushed aside."),
    "1.3": ([MAYA, DRAW], "She holds the finished drawing (second reference image) up towards the camera with both hands, beaming with pride, the drawing facing the camera and readable. Kitchen behind her."),
    "2.1": ([MAYA, DRAW], "From behind and above: an adult woman's hand holds a phone over the drawing (second reference image) lying on the kitchen table, taking a photo of it; the girl leans in beside her, watching. Only the woman's hand and forearm are visible."),
    "2.2": ([MAYA, PAINT], "The girl and her mother (a woman in her thirties, dark hair in a loose bun, grey sweater) side by side at the kitchen table, looking at a phone the mother holds; the girl leans in, curious. The phone screen faces them, not the camera."),
    "2.4": ([MAYA, PAINT], "Close on the girl's face looking at the phone: mouth open in a gasp, eyes wide, the beginning of a huge grin; her hand grabs her mother's arm. Kitchen softly behind."),
    "3.1": ([MAYA, VIOLET], "Shot from behind the phone's edge and slightly to the side: a phone stands on the kitchen table propped against a mug, its screen pointing straight at the girl's face (so we see only the BACK and edge of the phone, not its screen). She leans close to it, chin on her hands, curious, looking down into the screen. Her face is lit by its glow."),
    "3.2": ([MAYA], "The girl stands in the living room (lived-in: toys on the rug, a sofa with blankets), facing the camera, waving hello with her right hand raised high, big smile, whole body visible."),
    "3.3": ([MAYA], "The girl in the same lived-in living room, whole body, striking a superhero pose: one fist raised high, the other hand on her hip, chin up, laughing."),
    "3.4": ([MAYA, VIOLET], "Living room, three-quarter from behind: the girl stands facing a big TV on the wall that shows the 3D cartoon superhero girl from the second reference image (the TV faces her, we see it at an angle past her shoulder). Behind her, the mother (a woman in her thirties, dark hair in a loose bun, grey sweater) walks in from the kitchen holding a coffee mug, stops and looks past the girl at the TV with a warm, surprised smile."),
    "4.1": ([MAYA, VIOLET], "Living room, shot from behind the girl at three-quarter: she dances in front of a big TV on the wall, arms up wide; the TV faces her and shows the 3D cartoon superhero girl from the second reference image dancing on a stage with colourful lights. We see the girl's back and side, and the TV screen at an angle beyond her. Sofa and toys around."),
    "4.2": ([MAYA, VIOLET], "Living room, three-quarter from behind and to the side: the girl cheers with both fists in the air, laughing, facing a big TV on the wall. The TV screen (seen at an angle) shows EXACTLY the 3D cartoon superhero girl in the second reference image (pink dress, purple mask, purple sleeves, yellow cape, brown hair, pink boots) dancing on a colourful stage."),
    "5.1": ([MAYA, DRAW, VIOLET], "Kitchen table, three-quarter from behind the girl's shoulder: a laptop faces her, its screen showing a video call with a smiling grandmother (white hair, glasses, cardigan). The girl holds up, side by side at one height and close to the middle of the frame, in her left hand the crayon drawing from the second reference image facing the laptop, and in her right hand a phone facing the laptop showing the 3D superhero girl from the third reference image. We see the laptop screen past her shoulder, the back of the phone and the back of the paper (the drawing faces Grandma)."),
    "5.2": ([MAYA, DRAW, VIOLET], "A laptop screen filling most of the frame, showing a video call: a grandmother (white hair, glasses, cardigan) in her own cosy living room, her eyes on the screen, laughing with her hand on her heart, delighted. In the small picture-in-picture self-view in the corner of the laptop screen: the girl from the first reference image holding up, side by side, the crayon drawing from the second reference image (front facing the camera) in one hand and a phone showing the 3D superhero girl from the third reference image in the other. Both her hands and both things are clearly visible in that small self-view."),
}


def run(shot):
    refs, desc = SHOTS[shot]
    args = ["curl", "-s", "https://api.openai.com/v1/images/edits", "-H", "Authorization: Bearer proxy-injected",
            "-F", "model=gpt-image-2", "-F", "size=1536x1024", "-F", "quality=high",
            "--form-string", f"prompt={LOOK} {desc}"]
    for r in refs:
        args += ["-F", f"image[]=@{r}"]
    r = subprocess.run(args, capture_output=True, text=True, timeout=600)
    try:
        d = json.loads(r.stdout)
        png = base64.b64decode(d["data"][0]["b64_json"])  # decode first: a failure never empties a good still
        open(f"{OUT}/{shot}.png", "wb").write(png)
        return f"{shot} ok"
    except Exception:
        return f"{shot} FAILED {r.stdout[:300]}"


shots = sys.argv[2:] or list(SHOTS)
with cf.ThreadPoolExecutor(5) as ex:
    for res in ex.map(run, shots):
        print(res, flush=True)
