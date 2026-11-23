"""Keyframe stills for the master film (docs/content/scripts/master-film.md).

Each still is an edit of reference images (Maya, the kitchen, the drawing, the
painting, Violet) so the same girl appears every time. Runs shots in parallel.
usage: python keyframes.py outdir [shot ...]
"""
import base64, concurrent.futures as cf, json, os, subprocess, sys

S = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
MAYA = f"{S}/child/facetime.png"        # the girl, kitchen
DRAW = f"{S}/violet/original.jpg"       # Maya's drawing
PAINT = f"{S}/violet/rendered.png"      # the painting HeroMaker made
VIOLET = f"{S}/v_alpha/0040.png"         # Violet in 3D (our render)

LOOK = ("A still frame from a video a parent films on a phone at home, 16:9. Natural, "
        "lived-in, a little messy and imperfect, real daylight, nothing staged or glossy, "
        "slight handheld angle. The girl is EXACTLY the girl in the first reference image "
        "(same face, hair in two pigtails, yellow t-shirt), about 7 years old. No text, no logos, "
        "no app interface text.")

SHOTS = {
    "1.1": ([MAYA, DRAW], "Close-up over the kitchen table: her hand fills in a pink boot of her crayon drawing (the drawing in the second reference image, nearly finished), tongue out in concentration, crayons and a juice cup scattered around."),
    "1.2": ([MAYA, DRAW], "Over her shoulder at the kitchen table: the drawing from the second reference image almost done, she is colouring the yellow cape. Breakfast plates pushed aside."),
    "1.3": ([MAYA, DRAW], "She holds the finished drawing (second reference image) up towards the camera with both hands, beaming with pride, the drawing facing the camera and readable. Kitchen behind her."),
    "2.1": ([MAYA, DRAW], "From behind and above: an adult woman's hand holds a phone over the drawing (second reference image) lying on the kitchen table, taking a photo of it; the girl leans in beside her, watching. Only the woman's hand and forearm are visible."),
    "2.2": ([MAYA, PAINT], "The girl and her mother (a woman in her thirties, dark hair in a loose bun, grey sweater) side by side at the kitchen table, looking at a phone the mother holds; the girl leans in, curious. The phone screen faces them, not the camera."),
    "2.4": ([MAYA, PAINT], "Close on the girl's face looking at the phone: mouth open in a gasp, eyes wide, the beginning of a huge grin; her hand grabs her mother's arm. Kitchen softly behind."),
    "3.1": ([MAYA, VIOLET], "A phone propped up on the kitchen table against a mug, its screen showing the 3D cartoon superhero girl from the second reference image standing on a cream background. The girl leans close to it, curious, chin on her hands."),
    "3.2": ([MAYA], "The girl stands in the living room (lived-in: toys on the rug, a sofa with blankets), facing the camera, waving hello with her right hand raised high, big smile, whole body visible."),
    "3.3": ([MAYA], "The girl in the same lived-in living room, whole body, striking a superhero pose: one fist raised high, the other hand on her hip, chin up, laughing."),
    "3.4": ([MAYA, VIOLET], "Living room: the mother (a woman in her thirties, dark hair in a loose bun, grey sweater) walks into the frame holding a coffee mug, stops mid-step and stares at a tablet on the coffee table that shows the 3D cartoon superhero girl from the second reference image; the girl stands beside the table, delighted, looking up at her mum."),
    "4.1": ([MAYA, VIOLET], "On the sofa: the girl dances along, arms up, in front of a tablet on the coffee table whose screen shows the 3D cartoon superhero girl from the second reference image dancing on a stage with colourful lights."),
    "4.2": ([MAYA], "On the sofa: the girl cheers with both fists in the air, laughing, a tablet in front of her on the coffee table (screen not visible)."),
    "5.1": ([MAYA, VIOLET], "Video call on a laptop on the kitchen table: the laptop screen shows a smiling grandmother (white hair, glasses, cardigan). The girl holds up a phone towards the laptop camera; the phone screen shows the 3D cartoon superhero girl from the second reference image."),
    "5.2": ([MAYA], "A laptop screen filling most of the frame, showing a video call: a grandmother (white hair, glasses, cardigan) in her own cosy living room laughs with her hand on her heart, delighted. In the corner of the laptop screen, a small picture-in-picture of the girl from the reference image."),
}


def run(shot):
    refs, desc = SHOTS[shot]
    args = ["curl", "-s", "https://api.openai.com/v1/images/edits", "-H", "Authorization: Bearer sk-proxy",
            "-F", "model=gpt-image-2", "-F", "size=1536x1024", "-F", "quality=high",
            "--form-string", f"prompt={LOOK} {desc}"]
    for r in refs:
        args += ["-F", f"image[]=@{r}"]
    r = subprocess.run(args, capture_output=True, text=True, timeout=600)
    try:
        d = json.loads(r.stdout)
        open(f"{OUT}/{shot}.png", "wb").write(base64.b64decode(d["data"][0]["b64_json"]))
        return f"{shot} ok"
    except Exception:
        return f"{shot} FAILED {r.stdout[:300]}"


shots = sys.argv[2:] or list(SHOTS)
with cf.ThreadPoolExecutor(5) as ex:
    for res in ex.map(run, shots):
        print(res, flush=True)
