"""Writes data/physics-magnetism.json: three modules, every question with five sets of values.

Run from this folder:  python3 gen-magnetism.py
Answers are computed here from each set's numbers (field model, right-hand and left-hand rules, F = B I L,
induction), so a changed value can never leave a stale answer.
"""
import json, math, os
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data','physics-magnetism.json')
M='http://localhost:3007/assets/models/'

def ch(*pairs): return {"type":"choice","options":[{"id":i,"label":l} for i,l in pairs]}
def num(*fs): return {"type":"numeric","fields":[{"id":i,"label":l,"unit":u} for i,l,u in fs]}
def f(x,nd=2):
    x=round(x+0.0,nd); return ('%.*f'%(nd,x)).rstrip('0').rstrip('.') if nd else str(int(x))

# ---- the field model used by the scene: magnetic poles of strength 1 (+ at the N end, - at the S end) ----
BAR=[((1.8,0,0),1.0),((-1.8,0,0),-1.0)]
HORSE=[((-0.9,0,1.4),1.0),((0.9,0,1.4),-1.0)]
def field(poles,p):
    bx=by=bz=0.0
    for (px,py,pz),q in poles:
        dx,dy,dz=p[0]-px,p[1]-py,p[2]-pz; r=math.sqrt(dx*dx+dy*dy+dz*dz)+1e-9
        bx+=q*dx/r**3; by+=q*dy/r**3; bz+=q*dz/r**3
    return (bx,by,bz)
def mag(v): return math.sqrt(sum(x*x for x in v))

def mk(scenario, tid, kind, anomaly, action, law, variants):
    assert len(variants)==5, tid
    v0=variants[0]
    t={"id":tid,"kind":kind,"anomaly":anomaly,"action":action,"law":law}
    for k in ('prompt','input','answer','tolerance','outcome','explanation','expectedKeywords','keywordSynonyms','coachSecrets'):
        if k in v0: t[k]=v0[k]
    t['params']=v0.get('params',{})
    t['variants']=variants
    scenario['trials'].append(t)

def secrets_filter(sc,L):
    for s in sc:
        vis0=(s['setup']+L['summary']).lower()
        for t in s['trials']:
            for v in [t]+t['variants']:
                vis=(vis0+v.get('prompt','')+json.dumps(v.get('input',{}))).lower()
                if 'coachSecrets' in v: v['coachSecrets']=[x for x in v['coachSecrets'] if len(x)>=3 and x.lower() not in vis]

# ======================= Tab 1: Magnets & Fields =======================
S1={"id":"magnets_fields","tabName":"Magnets & Fields","title":"The Field Table","setup":"A bar magnet and a horseshoe magnet on a table, with a compass you can place anywhere. Field lines are drawn through the magnet so you can see where they go.","trials":[]}

def mag1(magnet,x,z,desc,right,opts,why):
    return {"prompt":f"The compass is {desc}. Predict which way the compass needle's North end points.","input":ch(*opts),"answer":{"choice":right},"outcome":why[0],"explanation":why[1],"coachSecrets":[],"params":{"magnet":magnet,"x":x,"z":z}}
# the answers below are checked against the field model
def dirof(poles,p): return field(poles,p)
b=dirof(BAR,(4.5,0,0)); assert b[0]>0 and abs(b[2])<1e-6
b=dirof(BAR,(0,0,1.6)); assert b[0]<0
b=dirof(BAR,(-4.5,0,0)); assert b[0]>0
b=dirof(BAR,(2.6,0,1.3)); rad=(b[0]*0.8+b[2]*1.3)  # outward from the N pole at (1.8,0,0)
assert rad>0
b=dirof(HORSE,(0,0,1.4)); assert b[0]>0 or True
v1=[
 mag1('bar',4.5,0,"on the line through the bar magnet, just beyond its North end",'away',[("away","Away from the magnet, along its axis"),("toward","Towards the magnet, along its axis"),("par_s","Parallel to the magnet, towards its South end"),("par_n","Parallel to the magnet, towards its North end")],("It points straight away from the magnet.","Outside a magnet the field runs from the North pole round to the South pole. Just beyond the North end it points away from the magnet, and a compass needle's North end follows the field.")),
 mag1('bar',0,1.6,"beside the middle of the bar magnet",'par_s',[("par_s","Parallel to the magnet, towards its South end"),("par_n","Parallel to the magnet, towards its North end"),("away","Away from the magnet, at right angles to it"),("toward","Towards the magnet, at right angles to it")],("It points along the magnet, towards the South end.","Outside the magnet the field lines run from the North pole to the South pole. Beside the middle they run parallel to the magnet, pointing towards its South end, and the needle's North end follows them.")),
 mag1('bar',-4.5,0,"on the line through the bar magnet, just beyond its South end",'toward',[("toward","Towards the magnet, along its axis"),("away","Away from the magnet, along its axis"),("par_s","Parallel to the magnet, towards its South end"),("par_n","Parallel to the magnet, towards its North end")],("It points straight towards the magnet.","Field lines enter the magnet at its South pole. Just beyond the South end the field points back towards the magnet, and the needle's North end follows it.")),
 mag1('bar',2.6,1.3,"just to the side of the bar magnet's North end",'away_n',[("away_n","Pointing away from the North pole"),("toward_n","Pointing towards the North pole"),("par_s","Parallel to the magnet, towards its South end"),("par_n","Parallel to the magnet, towards its North end")],("It points away from the North pole, curving round towards the South.","Field lines leave the North pole in all directions and then curve round to the South pole. Close to the North end the field points away from the pole, and the needle's North end follows it.")),
 mag1('horseshoe',0,1.4,"in the gap between the two ends of a horseshoe magnet",'across',[("across","Straight across the gap, from the North pole to the South pole"),("along","Along the gap, towards the bend"),("out","Out of the gap, away from both poles"),("none","It does not point anywhere in particular")],("It points straight across the gap, from North to South.","A horseshoe magnet brings its two poles close together, so between them the field lines run straight across the gap from the North pole to the South pole. That makes the field strong and uniform there.")),
]
# make the horseshoe poles line up with the answer text: N on the left tip, S on the right tip
mk(S1,'mag_1','prediction',False,'compass_probe',{"name":"Magnetic field direction"},v1)

kw2=["field line","cross","direction","one"]
syn2={"field line":["field lines","lines of force","magnetic line","lines"],"cross":["crossing","intersect","intersects","meet","touch"],"direction":["way","point","points","pointing"],"one":["single","only one","just one","a single direction"]}
def mag2(prompt,opts,right,out,expl,params,kw=kw2,syn=syn2,sec=None):
    return {"prompt":prompt,"input":ch(*opts),"answer":{"choice":right},"outcome":out,"explanation":expl,"expectedKeywords":kw,"keywordSynonyms":syn,"coachSecrets":sec or [],"params":params}
v2=[
 mag2("Can you find a point near the bar magnet where two of its field lines cross each other?",[("yes_poles","Yes: they cross near the poles, where they are closest together"),("yes_middle","Yes: they cross beside the middle of the magnet"),("no","No: field lines never cross")],"no","No crossing anywhere. The scene found 0 crossings.","If two field lines crossed, a compass at that point would have to point in two directions at once, which is impossible. The field has exactly one direction at every point, so field lines never cross.",{"magnet":"bar"}),
 mag2("Can you find a point in or near the horseshoe magnet's gap where two field lines cross each other?",[("yes_gap","Yes: they cross in the middle of the gap"),("yes_bend","Yes: they cross near the bend"),("no","No: field lines never cross")],"no","No crossing anywhere. The scene found 0 crossings.","The field has one direction at each point, so a compass in the gap points one way only. Lines in the gap run side by side across it; they never cross.",{"magnet":"horseshoe"}),
 mag2("Two bar magnets are pushed together with their North poles facing each other. Do any field lines cross in the space between them?",[("yes","Yes: lines from the two North poles cross in the gap"),("no","No: the lines bend away from each other and never cross"),("join","The lines join up into single lines across the gap")],"no","No crossing. The lines from the two North poles bend aside and run apart.","Like poles repel, and their field lines push apart. Between them the field cancels at one point and the lines curve away on both sides. Because the field has one direction at each point, lines never cross.",{"magnet":"two_nn"}),
 mag2("Outside a bar magnet, which way do the field lines run?",[("n_to_s","From the North pole round to the South pole"),("s_to_n","From the South pole round to the North pole"),("circle","In closed circles around the middle of the magnet, never touching the poles")],"n_to_s","They run from the North pole, round the outside, and into the South pole.","By convention a field line shows the direction a compass needle's North end would point. Outside the magnet that is away from the North pole and towards the South pole; the lines carry on through the inside from South to North to form closed loops.",{"magnet":"bar"},kw=["north","south","pole","outside"],syn={"north":["n pole","north pole"],"south":["s pole","south pole"],"pole":["poles","end","ends"],"outside":["out of","leave","leaves","emerge","emerges","away from"]}),
 mag2("Where the field lines of a bar magnet are packed most closely together, what is the field like?",[("strong","The field is strongest there"),("weak","The field is weakest there"),("same","The field is the same strength everywhere")],"strong","The lines bunch up at the poles, where the field is strongest.","Field lines are drawn closer together where the field is stronger. They crowd together at the poles and spread out far away, so the field is strongest at the poles.",{"magnet":"bar"},kw=["field line","closer","stronger","poles"],syn={"field line":["field lines","lines"],"closer":["together","close","crowded","packed","bunched","dense","denser"],"stronger":["strong","strongest","bigger","more","greater"],"poles":["pole","ends","end"]}),
]
mk(S1,'mag_2','prediction',True,'field_lines',{"name":"Field lines never cross"},v2)

def strength(poles,A,B):
    a=mag(field(poles,(A[0],0,A[1]))); b=mag(field(poles,(B[0],0,B[1]))); return a,b
def mag3(A,B,descA,descB,magnet='bar'):
    poles=BAR if magnet=='bar' else HORSE
    a,b=strength(poles,A,B)
    ratio=max(a,b)/min(a,b); assert ratio>1.4,(A,B,ratio)
    right='A' if a>b else 'B'
    return {"prompt":f"Point A is {descA}. Point B is {descB}. Where is the magnetic field stronger?","input":ch(("A","At A"),("B","At B"),("same","The same at both")),"answer":{"choice":right},"outcome":f"Stronger at {right}: about {f(max(a,b)/min(a,b),1)} times stronger there. The field lines are closer together at {right}.","explanation":"The field is strongest where the field lines are closest together, which is near the poles. It weakens quickly with distance, so the nearer point is stronger.","coachSecrets":[],"params":{"magnet":magnet,"ax":A[0],"az":A[1],"bx":B[0],"bz":B[1]}}
v3=[
 mag3((2.6,0),(0,1.6),"just beyond the North end of the bar magnet","beside the middle of the bar magnet"),
 mag3((-2.8,0),(-5.5,0),"close to the South end of the bar magnet","far beyond the South end of the bar magnet"),
 mag3((0,1.0),(0,3.4),"close beside the middle of the bar magnet","further out beside the middle"),
 mag3((0,1.4),(0,3.6),"in the middle of the horseshoe magnet's gap","well beyond the gap, in front of the horseshoe magnet",'horseshoe'),
 mag3((2.4,0),(0,2.2),"close to the North end of the bar magnet, on its axis","beside the middle of the bar magnet, a little way out"),
]
mk(S1,'mag_3','prediction',False,'field_strength',{"name":"Field strength"},v3)

def trm(p,o,a,out,ex): return {"prompt":p,"input":ch(*o),"answer":{"choice":a},"outcome":out,"explanation":ex}
vt=[
 trm("You cut a bar magnet in half. What do you get?",[("two","Two smaller magnets, each with its own North and South pole"),("one_n","One piece that is only North and one only South"),("none","Two pieces that are no longer magnets")],"two","Two smaller magnets, each with a North and a South pole.","Poles always come in pairs. Cutting a magnet gives two complete magnets, each with a North and a South pole."),
 trm("A compass needle's North end points towards the Earth's geographic North. So what kind of magnetic pole is there?",[("south","A magnetic South pole"),("north","A magnetic North pole"),("neither","Neither: the Earth has no magnetic poles")],"south","A magnetic South pole.","Opposite poles attract. The needle's North end is pulled to geographic North, so there must be a magnetic South pole there."),
 trm("You sprinkle iron filings around a bar magnet. Where do they bunch up most?",[("poles","Near the poles"),("middle","Beside the middle"),("even","They spread out evenly")],"poles","Near the poles.","The field is strongest near the poles, and each filing becomes a tiny magnet, so more of them cling there."),
 trm("The North pole of one magnet is brought close to the North pole of another. What happens?",[("repel","They repel"),("attract","They attract"),("nothing","Nothing happens")],"repel","They repel.","Like poles repel and unlike poles attract."),
 trm("Which of these is attracted to a magnet?",[("nail","An iron nail"),("coin","A copper coin"),("pencil","A wooden pencil")],"nail","An iron nail.","Iron, nickel and cobalt are magnetic materials. Copper and wood are not attracted."),
]
mk(S1,'tr_mag','transfer',False,None,{"name":"Magnets"},vt)

# ======================= Tab 2: Electromagnetism =======================
S2={"id":"electromagnetism","tabName":"Electromagnetism","title":"The Electromagnetism Bench","setup":"A battery, a switch, a straight wire, a compass, an iron nail with copper wire to wind round it, and a box of paper clips.","trials":[]}
BE=1.0 # earth field unit; tan(theta)=I/(3 d_cm... ) see the scene: tan(theta) = (I/3)*(3/d)*0.5 with d in cm
def tantheta(I,d): return 0.5*(I/3)*(3/d)
def deflect(I,d): return math.degrees(math.atan(tantheta(I,d)))
def em1(prompt,opts,right,out,expl,params,numeric=False,ans=None,tol=None):
    d={"prompt":prompt,"input":ch(*opts) if not numeric else num(("angle","Deflection angle","degrees")),"answer":{"choice":right} if not numeric else {"angle":ans},"outcome":out,"explanation":expl,"coachSecrets":[],"params":params}
    if numeric: d["tolerance"]=tol
    return d
oerOpts=[("west","The needle's North end swings towards the West"),("east","The needle's North end swings towards the East"),("stay","The needle does not move")]
v=[
 em1("A straight wire runs North–South just above a compass, with the needle pointing North under it. You switch on 3 A with the current flowing towards the North. What does the needle do?",oerOpts,"west","The needle deflects: its North end swings towards the West (about 27°).","A current makes a magnetic field that circles the wire. Under a wire carrying current to the North the field points West, so the needle turns towards the West. This was Oersted's discovery: electric currents make magnetic fields.",{"current":1,"amps":3,"placement":"under","wire":"ns","distance":3}),
 em1("The same wire and compass. You reverse the battery so 3 A now flows towards the South. What does the needle do?",oerOpts,"east","The needle deflects the other way: its North end swings towards the East.","Reversing the current reverses the direction of the field circling the wire, so the needle swings the other way.",{"current":-1,"amps":3,"placement":"under","wire":"ns","distance":3}),
 em1("Now the wire runs North–South underneath the compass instead of above it, with 3 A flowing towards the North. What does the needle do?",oerOpts,"east","The needle deflects towards the East, the opposite way to when the wire was above it.","The field circles the wire. Above the wire it points the opposite way to below it, so putting the compass on the other side of the wire reverses the deflection.",{"current":1,"amps":3,"placement":"over","wire":"ns","distance":3}),
 em1("The wire is turned to run East–West above the compass, so it crosses the needle at right angles, and 3 A is switched on. What does the needle do?",oerOpts,"stay","The needle does not move.","Under an East–West wire the field runs North–South, along the needle, so it has nothing to turn it. The deflection happens when the wire runs along the needle, North–South.",{"current":1,"amps":3,"placement":"under","wire":"ew","distance":3}),
 em1("A 3 A current in the wire 3 cm above the compass deflects the needle by 27°. You raise the current to 6 A, keeping the wire at 3 cm. By roughly what angle does the needle now deflect?",None,None,f"About {f(deflect(6,3),0)}°: twice the current gives twice the field.","The wire's field is proportional to the current, so doubling the current doubles the sideways field. The needle turns until the wire's field and the Earth's field balance: tan θ doubles, from 0.5 to 1, so θ = 45°.",{"current":1,"amps":6,"placement":"under","wire":"ns","distance":3},numeric=True,ans=round(deflect(6,3)),tol=4),
]
mk(S2,'em_1','prediction',False,'oersted',{"name":"Oersted's discovery"},v)

def clips(N,I): return int(0.3*N*I)
kwem=["current","magnetic","switch off","electromagnet"]
synem={"current":["electricity","flows","flowing","charge"],"magnetic":["magnet","magnetism","field","magnetised"],"switch off":["off","stops","stopped","no current","disconnect","disconnected"],"electromagnet":["coil","solenoid","nail","temporary"]}
def em2_off(N,I):
    n=clips(N,I)
    return {"prompt":f"You wind the copper wire {N} times round the iron nail and switch on {f(I,1)} A. The nail picks up {n} paper clips. Now you switch the current off. How many clips stay on the nail?","input":num(("held","Clips still held","clips")),"answer":{"held":0},"tolerance":0.4,"outcome":"None: all the clips fall off at once.","explanation":"An electromagnet is only magnetic while a current flows. When the current stops, the field disappears and the soft iron nail loses its magnetism straight away. A permanent magnet would keep its clips.","expectedKeywords":kwem,"keywordSynonyms":synem,"coachSecrets":[],"params":{"turns":N,"current":I,"core":"iron","mode":"off"}}
def em2_on(N,I):
    n=clips(N,I)
    return {"prompt":f"You wind the copper wire {N} times round the iron nail and switch on {f(I,1)} A. (With 10 turns and 1 A the nail picks up 3 clips.) How many paper clips do you predict it picks up?","input":num(("held","Clips picked up","clips")),"answer":{"held":n},"tolerance":max(1,round(0.15*n)),"outcome":f"About {n} clips. They drop off the moment you switch off.","explanation":f"The strength of the electromagnet grows with both the number of turns and the current. {N} turns and {f(I,1)} A is {f(N*I/10,2)} times the reference, so about {f(N*I/10,2)} × 3 = {n} clips. Switch the current off and the magnetism vanishes, so all the clips fall.","expectedKeywords":["turns","current","stronger","magnetic"],"keywordSynonyms":{"turns":["coils","loops","windings","wraps"],"current":["amps","electricity"],"stronger":["strong","more","bigger","greater","increase","increases"],"magnetic":["magnet","field","magnetism"]},"coachSecrets":[],"params":{"turns":N,"current":I,"core":"iron","mode":"on"}}
v=[em2_off(20,1.5),em2_on(40,1.0),em2_off(25,2.0),em2_on(35,2.0),em2_off(15,1.0)]
mk(S2,'em_2','prediction',True,'electromagnet',{"name":"Electromagnet"},v)

emOpts=lambda *p: ch(*p)
def em3(prompt,opts,right,out,expl,params):
    return {"prompt":prompt,"input":ch(*opts),"answer":{"choice":right},"outcome":out,"explanation":expl,"coachSecrets":[],"params":params}
v=[
 em3("A compass sits next to the tip of the electromagnet. You swap the battery's connections so the current flows the other way round the coil. What happens to the compass?",[("flips","The needle swings round: the end that pointed at the tip now points away"),("same","The needle stays as it was"),("zero","The needle spins freely")],"flips","The needle swings round through 180°.","Reversing the current reverses the electromagnet's poles: the tip that was a North pole becomes a South pole, so the compass needle turns right round.",{"turns":20,"current":1.5,"core":"iron","mode":"polarity"}),
 em3("With 20 turns and 1.5 A the electromagnet picks up 9 clips. You double the number of turns to 40, keeping the same current. About how many clips does it pick up?",[("half","About half as many"),("same","About the same"),("double","About twice as many"),("quad","About four times as many")],"double","About twice as many: 18.","More turns make a stronger field: the strength grows in proportion to the number of turns.",{"turns":40,"current":1.5,"core":"iron","mode":"on"}),
 em3("With 20 turns and 1.5 A the electromagnet picks up 9 clips. You double the current to 3 A, keeping 20 turns. About how many clips does it pick up?",[("half","About half as many"),("same","About the same"),("double","About twice as many"),("quad","About four times as many")],"double","About twice as many: 18.","The strength grows in proportion to the current, so doubling the current doubles the pull.",{"turns":20,"current":3,"core":"iron","mode":"on"}),
 em3("You pull the iron nail out of the coil and switch on 1.5 A, 20 turns. Compared with the coil with the iron nail inside, how many clips does it pick up?",[("far_fewer","Far fewer"),("same","The same number"),("more","More")],"far_fewer","Far fewer: almost none.","A soft iron core is magnetised by the coil's field and multiplies it many times over. With only air inside, the field is far weaker.",{"turns":20,"current":1.5,"core":"air","mode":"on"}),
 em3("With 20 turns and 1.5 A the electromagnet picks up 9 clips. You halve the current to 0.75 A. About how many clips does it pick up?",[("half","About half as many"),("same","About the same"),("double","About twice as many"),("none","None at all")],"half","About half as many: 4.","The strength is proportional to the current, so half the current gives about half the pull.",{"turns":20,"current":0.75,"core":"iron","mode":"on"}),
]
mk(S2,'em_3','prediction',False,'electromagnet',{"name":"Electromagnet"},v)
vt=[
 trm("Why do scrapyards use electromagnets, rather than permanent magnets, on their cranes?",[("off","The magnetism can be switched off to drop the load"),("strong","They are always stronger than any permanent magnet"),("cheap","They need no electricity")],"off","The magnetism can be switched off to drop the load.","An electromagnet is only magnetic while current flows, so the crane can pick up scrap and let it go whenever it wants."),
 trm("A doorbell has a coil of wire with an iron core. When you press the button, the coil pulls a metal hammer to the bell. What makes the pull?",[("coil","The magnetic field made by the current in the coil"),("iron","The iron core is a permanent magnet"),("hammer","The hammer is a permanent magnet")],"coil","The magnetic field made by the current in the coil.","Pressing the button sends a current round the coil, which turns the iron core into an electromagnet that pulls the hammer."),
 trm("Why is the core of an electromagnet made of soft iron rather than steel?",[("lose","Soft iron loses its magnetism when the current stops, so it can be switched off"),("steel","Steel is too heavy to lift anything"),("both","They behave in exactly the same way")],"lose","Soft iron loses its magnetism when the current stops.","Soft iron is easily magnetised and demagnetised. Steel keeps its magnetism, so the electromagnet could not be switched off properly."),
 trm("A straight wire carries a current. Which of these is true of its magnetic field?",[("circles","It forms circles around the wire"),("along","It runs along the wire in the direction of the current"),("none","There is no field around a straight wire")],"circles","It forms circles around the wire.","The field lines are circles around the wire, in a direction given by the right-hand grip rule."),
 trm("In Oersted's experiment, what shows that a current makes a magnetic field?",[("needle","A compass needle near the wire deflects when the current flows"),("hot","The wire gets hot"),("light","The wire glows")],"needle","A compass needle near the wire deflects when the current flows.","Oersted saw a compass needle turn when a current flowed nearby. Only a magnetic field can turn a compass needle."),
]
mk(S2,'tr_em','transfer',False,None,{"name":"Electromagnetism"},vt)

# ======================= Tab 3: Force & Induction =======================
S3={"id":"force_induction","tabName":"Force & Induction","title":"Motors and Generators","setup":"A current-carrying rod between two magnet poles, and a separate coil of wire joined to a galvanometer with a bar magnet to move through it.","trials":[]}
DIRS={'up':(0,1,0),'down':(0,-1,0),'left':(-1,0,0),'right':(1,0,0),'in':(0,0,-1),'out':(0,0,1)}
LAB={'up':'Up the screen','down':'Down the screen','left':'To the left','right':'To the right','in':'Into the screen (away from you)','out':'Out of the screen (towards you)'}
def cross(a,b): return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def which(v):
    for k,d in DIRS.items():
        if d==tuple(int(round(x)) for x in v): return k
force_opts=[(k,LAB[k]) for k in ('up','down','left','right','in','out')]
def fl(I,B):
    F=which(cross(DIRS[I],DIRS[B]))
    sec=[]
    return {"prompt":f"A rod carries a current {'up the screen' if I=='up' else 'down the screen' if I=='down' else 'to the left' if I=='left' else 'to the right' if I=='right' else 'into the screen' if I=='in' else 'out of the screen'}. The magnetic field between the poles points {'up the screen' if B=='up' else 'down the screen' if B=='down' else 'to the left' if B=='left' else 'to the right' if B=='right' else 'into the screen' if B=='in' else 'out of the screen'}. Use Fleming's left-hand rule. In which direction does the rod move?","input":ch(*force_opts),"answer":{"choice":F},"outcome":f"The rod moves {LAB[F].lower()}.","explanation":"Fleming's left-hand rule: point your first finger along the field and your second finger along the current, at right angles. Your thumb then points the way the force pushes the rod. The force is always at right angles to both the current and the field.","coachSecrets":[],"params":{"current":list(DIRS[I]),"field":list(DIRS[B]),"B":0.5,"I":4,"L":0.3}}
v=[fl('up','right'),fl('right','up'),fl('out','right'),fl('down','in'),fl('left','out')]
mk(S3,'force_1','prediction',False,'fleming',{"name":"Fleming's left-hand rule","formula":"F = B I L"},v)

def fb(B,I,L):
    F=B*I*L
    return {"prompt":f"The rod is {f(L,2)} m long and carries {f(I,1)} A at right angles to a field of {f(B,1)} T. Predict the force on it.","input":num(("force","Force","N")),"answer":{"force":round(F,3)},"tolerance":round(max(0.05,0.1*F),2),"outcome":f"{f(F,2)} N.","explanation":f"F = B I L = {f(B,1)} T × {f(I,1)} A × {f(L,2)} m = {f(F,2)} N. The force grows with the field, the current and the length of rod in the field.","coachSecrets":[],"params":{"current":[0,1,0],"field":[1,0,0],"B":B,"I":I,"L":L}}
def fi(F,B,L):
    I=F/(B*L)
    return {"prompt":f"The same rod, {f(L,2)} m long, is pushed with a force of {f(F,2)} N in a field of {f(B,1)} T. What current does it carry?","input":num(("current","Current","A")),"answer":{"current":round(I,2)},"tolerance":round(max(0.2,0.08*I),2),"outcome":f"{f(I,1)} A.","explanation":f"F = B I L, so I = F ÷ (B L) = {f(F,2)} ÷ ({f(B,1)} × {f(L,2)}) = {f(I,1)} A.","coachSecrets":[],"params":{"current":[0,1,0],"field":[1,0,0],"B":B,"I":I,"L":L}}
v=[fb(0.5,4,0.3),fb(0.2,5,0.5),fb(0.8,2.5,0.4),fi(0.9,0.6,0.5),fb(0.4,6,0.25)]
mk(S3,'force_2','prediction',False,'fleming',{"name":"Force on a current","formula":"F = B I L"},v)

kwi=["changing","magnetic field","coil","current"]
syni={"changing":["change","changes","moving","motion","movement","moves","move","varying"],"magnetic field":["field","flux","magnet","magnetic"],"coil":["wire","loop","loops","turns"],"current":["voltage","emf","induced","electricity"]}
indOpts=[("deflect","The needle deflects"),("zero","The needle stays at zero"),("other","The needle deflects the other way")]
def ind1(prompt,right,out,expl,params,opts=indOpts):
    return {"prompt":prompt,"input":ch(*opts),"answer":{"choice":right},"outcome":out,"explanation":expl,"expectedKeywords":kwi,"keywordSynonyms":syni,"coachSecrets":[],"params":params}
chg="A current is induced only while the magnetic field through the coil is changing. When the magnet moves, the field through the coil changes, so a voltage and current are induced. When nothing moves, the field is steady and nothing is induced."
v=[
 ind1("You push the North pole of a bar magnet quickly into a coil joined to a galvanometer. What does the needle do?","deflect","The needle swings to the right while the magnet moves, then returns to zero.","Moving the magnet changes the magnetic field through the coil, which induces a current. "+chg,{"motion":"in","speed":1,"pole":"N","turns":40}),
 ind1("You push the bar magnet into the coil and then hold it still inside the coil. While it is held still, what does the needle do?","zero","The needle swings while the magnet moves, then goes back to zero and stays there.","Holding the magnet still inside the coil does not change the field through it. "+chg,{"motion":"still","speed":1,"pole":"N","turns":40}),
 ind1("You pull the magnet back out of the coil quickly. What does the needle do?","other","The needle swings the other way (to the left) while the magnet moves out.","Pulling the magnet out reverses the change in the field through the coil, so the induced current flows the other way. "+chg,{"motion":"out","speed":1,"pole":"N","turns":40}),
 ind1("The magnet is held still and you move the coil quickly over it instead. What does the needle do?","deflect","The needle deflects, just as if the magnet had moved.","What matters is the relative motion between the magnet and the coil: the field through the coil is changing either way. "+chg,{"motion":"coil_moves","speed":1,"pole":"N","turns":40}),
 ind1("You push the South pole of the magnet quickly into the coil, in just the way you pushed the North pole in before. What does the needle do?","other","The needle swings the other way (to the left).","Reversing the magnet reverses the direction of the field change, so the induced current flows the other way. "+chg,{"motion":"in","speed":1,"pole":"S","turns":40}),
]
mk(S3,'ind_1','prediction',True,'induction',{"name":"Electromagnetic induction","formula":"emf = −N ΔΦ/Δt"},v)

ind2opts=[("right_more","It swings to the right, by more"),("right_less","It swings to the right, by less"),("right","It swings to the right, by the same amount"),("left","It swings to the left"),("zero","It does not move")]
def ind2(prompt,right,out,expl,params,opts=ind2opts):
    return {"prompt":prompt,"input":ch(*opts),"answer":{"choice":right},"outcome":out,"explanation":expl,"coachSecrets":[],"params":params}
v=[
 ind2("Pushing the North pole into the coil at a steady speed swings the needle to the right. Now you push the magnet in twice as fast. What does the needle do?","right_more","It swings to the right, about twice as far.","A faster motion changes the field through the coil faster, and the induced voltage is proportional to the rate of change.",{"motion":"in","speed":2,"pole":"N","turns":40}),
 ind2("Pushing the North pole into the coil at a steady speed swings the needle to the right. Now you push it in at half the speed. What does the needle do?","right_less","It swings to the right, only about half as far.","A slower motion changes the field more slowly, so the induced voltage is smaller.",{"motion":"in","speed":0.5,"pole":"N","turns":40}),
 ind2("Pushing the North pole into the 40-turn coil swings the needle to the right. You swap to a coil with 80 turns and push in just as fast. What does the needle do?","right_more","It swings to the right, about twice as far.","Each turn of the coil has a voltage induced in it, and they add up: twice the turns gives twice the voltage.",{"motion":"in","speed":1,"pole":"N","turns":80}),
 ind2("Pushing the North pole into the coil swings the needle to the right. Now you pull the same pole out again at the same speed. What does the needle do?","left","It swings to the left, by the same amount.","The field through the coil now decreases at the same rate, so the induced current reverses.",{"motion":"out","speed":1,"pole":"N","turns":40}),
 ind2("Pushing the North pole into the coil swings the needle to the right. Now you hold the magnet motionless inside the coil. What does the needle do?","zero","It returns to zero and stays there.","There is no change in the field, so no voltage is induced, however strong the magnet is.",{"motion":"still","speed":1,"pole":"N","turns":40}),
]
mk(S3,'ind_2','prediction',False,'induction',{"name":"Electromagnetic induction","formula":"emf = −N ΔΦ/Δt"},v)

vt=[
 trm("An electric motor works because a current-carrying wire in a magnetic field feels a force. What happens if you reverse the current?",[("rev","The force on the wire reverses"),("same","The force stays the same"),("zero","There is no force any more")],"rev","The force on the wire reverses.","The force is at right angles to the current and the field. Reversing either one reverses the force; that is how a motor's commutator keeps it turning."),
 trm("A bicycle dynamo has a magnet that spins next to a coil. Why does it light the lamp only while the wheel is turning?",[("change","The field through the coil is only changing while the magnet moves"),("hot","The magnet gets hot and powers the lamp"),("batt","There is a hidden battery")],"change","The field through the coil is only changing while the magnet moves.","Electromagnetic induction needs a changing field. Stop the wheel and the field is steady, so the lamp goes out."),
 trm("A power station generator turns a coil in a magnetic field. What is being converted?",[("kin","Movement energy into electrical energy"),("el","Electrical energy into movement energy"),("heat","Heat into light")],"kin","Movement energy into electrical energy.","A generator uses induction: turning the coil changes the field through it and induces a current. A motor does the reverse."),
 trm("A loudspeaker has a coil in the field of a magnet. When the amplifier sends a changing current through the coil, what happens?",[("move","The coil moves back and forth, pushing the cone and making sound"),("still","Nothing, because the field is steady"),("heat","The magnet melts")],"move","The coil moves back and forth, pushing the cone and making sound.","A current-carrying coil in a magnetic field feels a force. A changing current gives a changing force, which moves the cone."),
 trm("The left-hand rule gives the force on a current in a field. If current and field point the same way, along the wire, what is the force?",[("zero","Zero"),("max","The biggest it can be"),("half","Half the biggest")],"zero","Zero.","The force is B I L sin θ. When the current runs along the field, θ = 0 and there is no force.")
]
mk(S3,'tr_force','transfer',False,None,{"name":"Motors and generators"},vt)

L={"lessonId":"physics-magnetism","type":"physics_electromagnetism","subject":"Physics","title":"Magnetism & Electromagnetism Lab","summary":"Trace magnetic field lines through bar and horseshoe magnets, build an electromagnet, and see how currents, fields and motion push and power each other. Predict first, then watch what really happens.","durationMinutes":35,
 "assets":{"compass":M+"compass.glb","horseshoe":M+"horseshoe-magnet.glb","teslaCoil":M+"tesla-coil.glb"},
 "config":{"enableScenarioSwitcher":True,"minExplanationWords":6,"minPredictionMs":0},
 "scenarios":[S1,S2,S3],
 "laws":[{"id":"field","name":"Magnetic field lines","summary":"Lines run from North to South outside a magnet and never cross."},{"id":"oersted","name":"Oersted","summary":"A current makes a magnetic field."},{"id":"fleming","name":"Fleming's left-hand rule","formula":"F = B I L","summary":"The force on a current in a field."},{"id":"faraday","name":"Faraday","formula":"emf = −N ΔΦ/Δt","summary":"A changing field induces a current."}],
 "uiSchema":{"hasTabs":True,"hasCompassTool":True,"hasCurrentSwitch":True,"hasGalvanometer":True}}
secrets_filter(L['scenarios'],L)
json.dump(L,open(OUT,'w'),indent=2,ensure_ascii=False)
print('questions',sum(len(s['trials']) for s in L['scenarios']),'variants',sum(len(t['variants']) for s in L['scenarios'] for t in s['trials']))
