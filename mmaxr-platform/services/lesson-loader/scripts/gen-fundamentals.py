"""Writes data/physics-fundamentals.json: four modules that explain the fundamental quantities one at a time.

Run from this folder:  python3 scripts/gen-fundamentals.py
Every concept opens with a concept card (what it is, its formula, its SI unit, scalar or vector, everyday examples),
then questions that make the student predict, watch and explain. Answers are computed here from each set of values,
so a changed number can never leave a stale answer. g = 9.8 N/kg on Earth and 1.6 N/kg on the Moon.
The original contract is kept in data/archive/physics-fundamentals.original.json.
"""
import json, math, os
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data','physics-fundamentals.json')
M='http://localhost:3007/assets/models/'
G=9.8; GM=1.6
def ch(*pairs): return {"type":"choice","options":[{"id":i,"label":l} for i,l in pairs]}
def num(*fs): return {"type":"numeric","fields":[{"id":i,"label":l,"unit":u} for i,l,u in fs]}
def f(x,nd=1):
    x=round(x+0.0,nd); s=('%.*f'%(nd,x)).rstrip('0').rstrip('.') if nd else str(int(x))
    return '0' if s in ('-0','') else s
def mk(sc,tid,kind,anomaly,action,law,variants,concept=None):
    assert len(variants)==5,tid
    v0=variants[0]; t={"id":tid,"kind":kind,"anomaly":anomaly,"action":action,"law":law}
    if concept: t['concept']=concept
    for k in ('prompt','input','answer','tolerance','outcome','explanation','expectedKeywords','keywordSynonyms','coachSecrets'):
        if k in v0: t[k]=v0[k]
    t['params']=v0.get('params',{}); t['variants']=variants; sc['trials'].append(t)
def trm(p,o,a,out,ex,params=None): return {"prompt":p,"input":ch(*o),"answer":{"choice":a},"outcome":out,"explanation":ex,"coachSecrets":[],"params":params or {}}
def tol(x,pct=0.05,lo=0.1): return round(max(lo,abs(x)*pct),2)
def concept(title,idea,examples,formula=None,unit=None,kind=None):
    c={"title":title,"idea":idea,"examples":examples}
    if formula: c['formula']=formula
    if unit: c['unit']=unit
    if kind: c['kind']=kind
    return c
def secrets_filter(sc,L):
    for s in sc:
        vis0=(s['setup']+L['summary']).lower()
        for t in s['trials']:
            for v in [t]+t['variants']:
                vis=(vis0+v.get('prompt','')+json.dumps(v.get('input',{}))).lower()
                if 'coachSecrets' in v: v['coachSecrets']=[x for x in v['coachSecrets'] if len(x)>=3 and x.lower() not in vis]

# =================== Tab 1: Kinematics & Vectors ===================
S1={"id":"kinematics_vectors","tabName":"Kinematics & Vectors","title":"The Circular Track","setup":"A car on a circular test track. The odometer counts every metre driven (distance), a gold arrow always points from the start line to the car (displacement), a blue arrow shows the car's velocity and an orange one its acceleration.","trials":[]}
SV={"name":"Scalars and vectors","formula":"vector = size + direction"}
KIN={"name":"Distance and displacement","formula":"displacement = straight line from start to finish"}
SPD={"name":"Speed and velocity","formula":"speed = distance ÷ time; velocity = displacement ÷ time"}
ACC={"name":"Acceleration","formula":"a = (v − u) ÷ t"}

def sv1(a,b):
    d=math.hypot(a,b)
    return {"prompt":f"The car drives {f(a,0)} m due east, turns left and drives {f(b,0)} m due north. Its odometer will show {f(a+b,0)} m. Predict the size of its displacement from the start.","input":num(("disp","Displacement","m")),"answer":{"disp":round(d,2)},"tolerance":tol(d,0.04,0.3),"outcome":f"{f(d)} m, pointing north-east, although the odometer reads {f(a+b,0)} m.","explanation":f"Distance only adds up the path: {f(a,0)} + {f(b,0)} = {f(a+b,0)} m, a scalar. Displacement is the straight arrow from start to finish, a vector. The two legs are at right angles, so its size is √({f(a,0)}² + {f(b,0)}²) = {f(d)} m, and it has a direction too.","coachSecrets":[f(d)+" m"],"params":{"a":a,"b":b}}
mk(S1,'sv_1','prediction',False,'walk',SV,[sv1(3,4),sv1(6,8),sv1(5,12),sv1(9,12),sv1(8,15)],concept(
 "Scalars and vectors","A scalar has only a size (a number and a unit). A vector has a size and a direction, so it is drawn as an arrow. Two vectors add like arrows placed head to tail, not like plain numbers.",
 ["Scalars: distance, speed, mass, time, temperature, energy, work, power","Vectors: displacement, velocity, acceleration, force, momentum, impulse, weight","3 m east + 4 m north is not 7 m: it is a 5 m arrow pointing north-east"],
 formula="vector = size + direction",kind="Both"))
def sv2(opts,ans,why):
    return trm("Which one of these is a vector quantity?",opts,ans,f"{dict(opts)[ans]}.",why)
v=[
 sv2([("vel","Velocity"),("spd","Speed"),("mass","Mass")],"vel","Velocity has a direction (north at 20 m/s); speed and mass are just sizes."),
 sv2([("force","Force"),("temp","Temperature"),("time","Time")],"force","A force always acts in a direction: a push to the left is not the same as a push to the right."),
 sv2([("disp","Displacement"),("dist","Distance"),("energy","Energy")],"disp","Displacement is an arrow from start to finish; distance and energy have no direction."),
 sv2([("mom","Momentum"),("power","Power"),("work","Work")],"mom","Momentum points the way the object moves; power and work are scalars."),
 sv2([("acc","Acceleration"),("vol","Volume"),("dens","Density")],"acc","Acceleration has a direction: speeding up forwards, slowing down, or turning."),
]
for x in v: x['prompt']=["Which one of these is a vector quantity?","Only one of these has a direction as well as a size. Which?","Pick the vector:","Which quantity needs an arrow to describe it fully?","One of these is a vector. Which one?"][v.index(x)]
mk(S1,'sv_2','prediction',False,None,SV,v)

def dis1(C,frac):
    R=C/(2*math.pi); d=frac*C; disp=2*R*math.sin(math.pi*frac)
    name={0.25:"a quarter of a lap",0.5:"half a lap",0.75:"three quarters of a lap"}[frac]
    return {"prompt":f"The track is a circle {f(C,0)} m round (radius {f(R)} m). The car drives {name} from the start line. Predict the odometer (distance) and the length of the displacement arrow.","input":num(("dist","Distance","m"),("disp","Displacement","m")),"answer":{"dist":round(d,2),"disp":round(disp,2)},"tolerance":{"dist":tol(d,0.03,0.5),"disp":tol(disp,0.05,0.5)},"outcome":f"Distance {f(d)} m; displacement {f(disp)} m.","explanation":f"Distance is the length of track driven: {f(frac,2)} × {f(C,0)} = {f(d)} m. Displacement is the straight chord from the start to the car: {'2 × radius = ' if frac==0.5 else 'radius × √2 = '}{f(disp)} m. The straight line is always the shortest path, so displacement is never more than distance.","coachSecrets":[f(d)+" m",f(disp)+" m"],"params":{"C":C,"frac":frac}}
mk(S1,'dis_1','prediction',False,'lap',KIN,[dis1(100,0.5),dis1(120,0.25),dis1(80,0.75),dis1(150,0.5),dis1(90,0.25)],concept(
 "Distance and displacement","Distance is how much ground you cover, measured along the path: a scalar. Displacement is the change in position: an arrow from where you started to where you are now, a vector. Go round in a circle and they can be very different.",
 ["A runner on a 400 m track runs 400 m but ends where she started","A taxi meter charges for distance, not displacement","A plane flying 300 km north then 400 km east has a displacement of 500 km north-east"],
 formula="displacement = final position − initial position",unit="metre (m)",kind="Distance: scalar · Displacement: vector"))
kw1=["start","position","direction","zero"]
syn1={"start":["starting point","beginning","same place","same point","where it began","began","started"],"position":["place","point","location","spot","finish","end"],"direction":["arrow","vector","straight line","way"],"zero":["0","nothing","none","no displacement","cancel","cancels"]}
def kin1(C,laps):
    return {"prompt":f"The track is {f(C,0)} m round. Drive the car {'one full lap' if laps==1 else f'{laps} full laps'} back to the start line. The odometer will read {f(C*laps,0)} m. Predict what the displacement arrow will show.","input":ch(("equal","Displacement will equal the distance travelled"),("zero","Displacement will be zero"),("half","Displacement will be half the distance")),"answer":{"choice":"zero"},"outcome":f"Zero: the arrow shrinks back to nothing, although the car drove {f(C*laps,0)} m.","explanation":"Distance is a scalar: the total path length keeps adding up. Displacement is a vector: the change in position from start to finish. The car finishes exactly where it started, so its displacement is zero, whatever distance it covered on the way.","expectedKeywords":kw1,"keywordSynonyms":syn1,"coachSecrets":[],"params":{"C":C,"frac":laps}}
mk(S1,'kin_1','prediction',True,'lap',KIN,[kin1(100,1),kin1(120,1),kin1(80,2),kin1(150,1),kin1(90,2)])

def spd1(C,frac,t):
    R=C/(2*math.pi); d=frac*C; disp=2*R*abs(math.sin(math.pi*frac)); s=d/t; vel=disp/t
    name={0.25:"a quarter of a lap",0.5:"half a lap",1:"one full lap"}[frac]
    return {"prompt":f"The {f(C,0)} m track (radius {f(R)} m): the car drives {name} in {f(t,0)} s. Predict its average speed and the size of its average velocity.","input":num(("speed","Average speed","m/s"),("vel","Average velocity","m/s")),"answer":{"speed":round(s,2),"vel":round(vel,2)},"tolerance":{"speed":tol(s,0.04,0.2),"vel":tol(vel,0.06,0.2)},"outcome":f"Average speed {f(s)} m/s; average velocity {f(vel)} m/s.","explanation":f"Average speed = distance ÷ time = {f(d)} ÷ {f(t,0)} = {f(s)} m/s. Average velocity = displacement ÷ time = {f(disp)} ÷ {f(t,0)} = {f(vel)} m/s{', because the car is back where it started' if frac==1 else ', in the direction of the displacement arrow'}.","coachSecrets":[f(s)+" m/s",f(vel)+" m/s"],"params":{"C":C,"frac":frac,"t":t}}
mk(S1,'spd_1','prediction',False,'lap',SPD,[spd1(100,0.5,10),spd1(120,1,15),spd1(80,0.5,8),spd1(160,0.25,5),spd1(90,1,12)],concept(
 "Speed and velocity","Speed is how fast the distance grows: a scalar. Velocity is how fast the displacement changes: speed in a stated direction, a vector. Two cars at 60 km/h going opposite ways have the same speed but different velocities.",
 ["A speedometer shows speed, not velocity","Weather reports give wind velocity: 20 km/h from the west","A satellite in orbit has steady speed but its velocity is always changing direction"],
 formula="speed = distance ÷ time;  velocity = displacement ÷ time",unit="metre per second (m/s)",kind="Speed: scalar · Velocity: vector"))
def spd2(v,q):
    if q==0: p=f"The car goes round the circular track at a steady {f(v,0)} m/s: the speedometer never moves. Does its velocity change?"
    elif q==1: p=f"Watch the blue velocity arrow while the car circles at a constant {f(v,0)} m/s. Is the velocity constant?"
    elif q==2: p=f"A car keeps its speedometer fixed at {f(v,0)} m/s all the way round a bend. Is its velocity the same at every point?"
    elif q==3: p=f"At a steady {f(v,0)} m/s round the circle, compare the car's velocity on opposite sides of the track."
    else: p=f"The cruise control holds {f(v,0)} m/s as the car circles. What happens to its velocity?"
    return {"prompt":p,"input":ch(("changes","It changes: its direction keeps turning"),("same","It stays the same: the speed is steady"),("brake","It changes only if the car brakes")),"answer":{"choice":"changes"},"outcome":f"The velocity keeps changing: the arrow stays {f(v,0)} m/s long but swings round with the car.","explanation":"Velocity is a vector, so a change of direction is a change of velocity, even with the speed fixed. On opposite sides of the circle the velocity arrows point in opposite directions.","coachSecrets":[],"params":{"C":100,"frac":1,"v":v,"steady":True}}
mk(S1,'spd_2','prediction',False,'lap',SPD,[spd2(10,0),spd2(12,1),spd2(8,2),spd2(15,3),spd2(10,4)])
def acc1(u,v_,t):
    a=(v_-u)/t
    return {"prompt":f"The car is moving at {f(u,0)} m/s. {'It speeds up' if v_>u else 'It brakes'} steadily to {f(v_,0)} m/s in {f(t,0)} s. Predict its acceleration (negative if it is slowing down).","input":num(("acc","Acceleration","m/s²")),"answer":{"acc":round(a,2)},"tolerance":tol(a,0.05,0.15),"outcome":f"{f(a)} m/s²{': a deceleration' if a<0 else ''}.","explanation":f"Acceleration is the change in velocity each second: ({f(v_,0)} − {f(u,0)}) ÷ {f(t,0)} = {f(a)} m/s². {'Every second the car gains '+f(a)+' m/s.' if a>0 else 'The minus sign means it loses '+f(-a)+' m/s every second: it is slowing down.'}","coachSecrets":[f(a)+" m/s"],"params":{"u":u,"v":v_,"t":t,"C":100}}
mk(S1,'acc_1','prediction',False,'accel',ACC,[acc1(0,20,5),acc1(10,30,4),acc1(0,24,8),acc1(5,25,5),acc1(30,10,4)],concept(
 "Acceleration","Acceleration is how quickly velocity changes. Because velocity is a vector, you accelerate when you speed up, when you slow down (a negative acceleration, or deceleration) and when you change direction.",
 ["A sprinter leaving the blocks","A car braking at a red light (negative acceleration)","A ball thrown up slows by 9.8 m/s every second: gravity's acceleration","Going round a roundabout at steady speed"],
 formula="a = (v − u) ÷ t",unit="metre per second squared (m/s²)",kind="Vector"))
kwa=["direction","velocity","centre","changing"]
syna={"direction":["turning","turn","turns","curve","bend","way it points"],"velocity":["vector","speed and direction"],"centre":["center","middle","inwards","inward","towards the middle"],"changing":["changes","change","keeps changing","different"]}
def acc2(v,q):
    pr=[f"The car circles the track at a steady {f(v,0)} m/s. Its speed never changes. Is it accelerating?",
        f"With cruise control fixed at {f(v,0)} m/s, the car goes round and round the circle. Is there any acceleration?",
        f"The speedometer reads {f(v,0)} m/s the whole way round the circle. Does the orange acceleration arrow appear?",
        f"A car takes a long circular bend at a constant {f(v,0)} m/s. Is it accelerating?",
        f"Steady {f(v,0)} m/s, round in a circle. Accelerating or not?"][q]
    return {"prompt":pr,"input":ch(("yes","Yes, towards the centre of the circle"),("no","No, its speed is constant"),("fwd","Yes, forwards along the track")),"answer":{"choice":"yes"},"outcome":"Yes: an acceleration arrow points to the centre of the circle the whole time.","explanation":"Acceleration is a change in velocity, and velocity includes direction. Going round the circle the direction keeps changing, so the car accelerates towards the centre (centripetal acceleration), even at a constant speed. The tyres' grip supplies the force that causes it.","expectedKeywords":kwa,"keywordSynonyms":syna,"coachSecrets":[],"params":{"C":100,"frac":1,"v":v,"steady":True,"showAcc":True}}
mk(S1,'acc_2','prediction',True,'lap',ACC,[acc2(10,0),acc2(12,1),acc2(8,2),acc2(15,3),acc2(10,4)])
vt=[
 trm("You walk 30 m to the shop and 30 m back home. What is your displacement?",[("zero","0 m"),("sixty","60 m"),("thirty","30 m")],"zero","0 m.","You end where you began, so the change in position is zero; the distance walked is 60 m."),
 trm("A plane flies at 900 km/h due north. Which describes its velocity?",[("vel","900 km/h north"),("spd","900 km/h"),("dist","900 km")],"vel","900 km/h north.","Velocity needs a direction; 900 km/h alone is just the speed."),
 trm("A car's velocity changes from 20 m/s to 0 in 4 s. Its acceleration is…",[("neg","−5 m/s²"),("pos","5 m/s²"),("eighty","80 m/s²")],"neg","−5 m/s².","a = (0 − 20) ÷ 4 = −5 m/s²: it is slowing down."),
 trm("The Moon goes round the Earth at a nearly constant speed. Is it accelerating?",[("yes","Yes, its direction keeps changing"),("no","No, its speed is constant"),("only","Only when it speeds up")],"yes","Yes.","Changing direction means changing velocity, so the Moon accelerates towards the Earth."),
 trm("A swimmer swims 4 lengths of a 25 m pool. Distance and displacement?",[("100_0","100 m and 0 m"),("100_100","100 m and 100 m"),("0_100","0 m and 100 m")],"100_0","100 m and 0 m.","Four lengths is 100 m of path, but an even number of lengths brings the swimmer back to the start."),
]
mk(S1,'tr_kin','transfer',False,None,SV,vt)

# =================== Tab 2: Dynamics & Impulse ===================
S2={"id":"dynamics_impulse","tabName":"Dynamics & Impulse","title":"The Crash Lab","setup":"A low-friction air track with carts of different masses, a Newton's cradle, and a drop tower where an egg falls onto a concrete slab or a thick foam cushion. Live readouts show mass, velocity, momentum, force and impact time.","trials":[]}
MOM={"name":"Momentum","formula":"p = m × v"}
CONS={"name":"Conservation of momentum","formula":"total momentum before = total momentum after"}
FRC={"name":"Newton's second law","formula":"F = m × a"}
IMP={"name":"Impulse","formula":"impulse = F × t = change in momentum"}
def mom1(m1,v1,m2,v2):
    vf=(m1*v1+m2*v2)/(m1+m2)
    def d(v): return 'at rest' if v==0 else f"at {f(abs(v),0)} m/s to the {'right' if v>0 else 'left'}"
    return {"prompt":f"Cart A ({f(m1)} kg) moves {d(v1)}. Cart B ({f(m2)} kg) is {d(v2)}. They collide and stick together. Predict their velocity just after (+ to the right, − to the left).","input":num(("v","Velocity after","m/s")),"answer":{"v":round(vf,2)},"tolerance":tol(vf,0.06,0.15),"outcome":f"{f(vf,2)} m/s{' to the right' if vf>0 else ' to the left' if vf<0 else ''}.","explanation":f"Momentum p = m × v, with a sign for its direction. Before: {f(m1)} × {f(v1,0)} + {f(m2)} × {f(v2,0)} = {f(m1*v1+m2*v2)} kg·m/s. No outside force acts, so the total is the same after: {f(m1*v1+m2*v2)} ÷ {f(m1+m2)} kg = {f(vf,2)} m/s.","coachSecrets":[f(vf,2)+" m/s"],"params":{"m1":m1,"v1":v1,"m2":m2,"v2":v2}}
mk(S2,'mom_1','prediction',False,'collide',CONS,[mom1(1,6,2,0),mom1(4,2,2,-1),mom1(3,4,1,0),mom1(2,5,3,-5),mom1(2,6,1,3)],concept(
 "Momentum","Momentum is mass in motion: how hard it is to stop something. It is mass × velocity, so it has a direction. In a collision with no outside force, the total momentum of everything involved stays the same: it is passed on, never lost.",
 ["A slow lorry can have more momentum than a fast bicycle","A rifle recoils backwards as the bullet goes forwards","A Newton's cradle passes momentum through the balls","Rockets push gas backwards to gain forward momentum"],
 formula="p = m × v",unit="kilogram metre per second (kg·m/s)",kind="Vector"))
kwm=["momentum","equal","opposite","cancel"]
synm={"momentum":["mass times velocity","m × v","mv","p"],"equal":["same","same size","equal size","equally"],"opposite":["opposite directions","towards each other","head on","different directions","other way"],"cancel":["cancels","cancelled","add to zero","zero","total is zero","balance","balanced"]}
def mom2(m1,v1,m2,v2):
    return {"prompt":f"A light, fast cart ({f(m1)} kg at {f(v1,0)} m/s to the right) and a heavy, slow cart ({f(m2)} kg at {f(-v2,0)} m/s to the left) meet head-on and stick together. Predict what happens.","input":ch(("stop","They stop dead"),("heavy","They move off in the heavy cart's direction"),("fast","They move off in the fast cart's direction")),"answer":{"choice":"stop"},"outcome":"They stop dead, as if the crash had swallowed all the motion.","explanation":f"Size and speed alone do not decide it; momentum does. The light cart has {f(m1)} × {f(v1,0)} = {f(m1*v1)} kg·m/s to the right and the heavy one {f(m2)} × {f(-v2,0)} = {f(-m2*v2)} kg·m/s to the left. Equal and opposite momenta add to zero, so the joined carts have zero momentum after the crash.","expectedKeywords":kwm,"keywordSynonyms":synm,"coachSecrets":[],"params":{"m1":m1,"v1":v1,"m2":m2,"v2":v2}}
mk(S2,'mom_2','prediction',True,'collide',CONS,[mom2(1,6,3,-2),mom2(2,4,4,-2),mom2(0.5,8,2,-2),mom2(1,9,3,-3),mom2(2,6,4,-3)])
def crd(n,q):
    pr=[f"In a Newton's cradle of five steel balls, you pull back {n} ball{'s' if n>1 else ''} and let go. How many balls fly out at the other end?",
        f"Lift {n} ball{'s' if n>1 else ''} at one end of the cradle and release. Predict what leaves the far end.",
        f"The cradle has five identical balls. {n} swing{'s' if n==1 else ''} in and hit the rest. What happens at the far end?",
        f"Pull {n} ball{'s' if n>1 else ''} aside, let go, and watch the last ball{'s' if n>1 else ''}. What swings out?",
        f"{n} ball{'s' if n>1 else ''} strike{'s' if n==1 else ''} the row of five. What flies out on the other side?"][q]
    return {"prompt":pr,"input":ch(("n",f"{n} ball{'s' if n>1 else ''}, as fast as {'they' if n>1 else 'it'} came in"),("one","One ball, moving faster"),("all","All the balls move off slowly together")),"answer":{"choice":"n"},"outcome":f"{n} ball{'s' if n>1 else ''} fl{'y' if n>1 else 'ies'} out, at the speed the first {'ones' if n>1 else 'one'} arrived.","explanation":"Momentum and kinetic energy are both passed along the row. One ball moving twice as fast would carry the right momentum but twice the energy. All five moving slowly would carry the right momentum but too little energy. Only the same number of balls at the same speed keeps both totals the same.","coachSecrets":[],"params":{"n":n}}
mk(S2,'crd_1','prediction',False,'cradle',MOM,[crd(1,0),crd(2,1),crd(3,2),crd(2,3),crd(1,4)])
def frc1(m,F):
    a=F/m
    return {"prompt":f"A {f(m)} kg cart sits on the frictionless air track. A force sensor pushes it with a steady {f(F,0)} N. Predict its acceleration.","input":num(("acc","Acceleration","m/s²")),"answer":{"acc":round(a,2)},"tolerance":tol(a,0.05,0.1),"outcome":f"{f(a,2)} m/s².","explanation":f"Newton's second law: F = m × a, so a = F ÷ m = {f(F,0)} ÷ {f(m)} = {f(a,2)} m/s². Every second the cart gains {f(a,2)} m/s, in the direction of the push.","coachSecrets":[f(a,2)+" m/s"],"params":{"m":m,"F":F}}
mk(S2,'frc_1','prediction',False,'push',FRC,[frc1(2,10),frc1(5,20),frc1(4,6),frc1(10,35),frc1(3,12)],concept(
 "Force","A force is a push or a pull. An unbalanced force changes an object's velocity: it starts it, stops it, speeds it up, slows it down or turns it. The bigger the mass, the more force is needed for the same acceleration.",
 ["Contact forces: push, pull, friction, air resistance, tension, normal reaction","Non-contact forces: gravity (weight), magnetic, electrostatic","Kicking a football, braking a bicycle, a magnet pulling a pin","1 N is the force that gives 1 kg an acceleration of 1 m/s²"],
 formula="F = m × a",unit="newton (N)",kind="Vector"))
def frc2(m,F,k):
    return {"prompt":f"The same {f(F,0)} N push now acts on a cart {k} times as heavy ({f(m*k)} kg instead of {f(m)} kg). How does its acceleration compare?","input":ch(("frac",f"1/{k} as much"),("same","The same"),("mult",f"{k} times as much")),"answer":{"choice":"frac"},"outcome":f"1/{k} as much: {f(F/(m*k),2)} m/s² instead of {f(F/m,2)} m/s².","explanation":f"a = F ÷ m. With the force fixed, {k} times the mass gives 1/{k} of the acceleration. Mass measures how hard it is to change an object's motion (its inertia).","coachSecrets":[],"params":{"m":m,"F":F,"m2":m*k}}
mk(S2,'frc_2','prediction',False,'push',FRC,[frc2(2,10,2),frc2(1,6,3),frc2(2,12,2),frc2(1.5,9,4),frc2(3,18,3)])
def dyn1(h):
    return {"prompt":f"Drop the egg from {f(h)} m onto the concrete. Then drop an identical egg from the same height onto the foam. Predict which one will break.","input":ch(("concrete","The egg on concrete will break"),("foam","The egg on foam will break"),("neither","Neither will break")),"answer":{"choice":"concrete"},"outcome":"The egg on concrete breaks. The egg on foam survives.","explanation":"Both eggs hit at the same speed, with the same momentum, and both are stopped. Concrete stops the egg in about two thousandths of a second; the foam squashes and takes about a tenth of a second. The same change in momentum spread over a longer time needs a much smaller force.","coachSecrets":[],"params":{"h":h,"m":0.06,"tc":0.002,"tf":0.1,"surface":"both"}}
mk(S2,'dyn_1','prediction',False,'egg',IMP,[dyn1(1.0),dyn1(1.5),dyn1(0.8),dyn1(2.0),dyn1(1.2)],concept(
 "Impulse","Impulse is a force acting for a time. It equals the change in momentum it causes. To stop a moving object you must take away all its momentum: do it fast and the force is huge; do it slowly and the force is small.",
 ["Airbags and crumple zones make a crash last longer, so the force on people is smaller","Bending your knees when you land","Pulling your hands back to catch a cricket ball","A karate chop is fast, so the force on the board is big","Follow-through in golf and tennis keeps the force on for longer, giving more momentum"],
 formula="impulse = F × t = m × v − m × u",unit="newton second (N·s), the same as kg·m/s",kind="Vector"))
kwi=["time","force","momentum","impulse"]
syni={"time":["longer","slowly","more time","duration","takes longer","slower"],"force":["push","impact","hit","smaller force","less force"],"momentum":["mass times velocity","m × v","mv","motion"],"impulse":["force times time","f × t","ft","change in momentum"]}
def dyn2(h,m):
    v=math.sqrt(2*G*h); p=m*v
    pr=["Both the concrete and the foam bring the egg to a stop: the change in momentum is the same. Why does the foam protect the egg?",
        f"An egg dropped {f(h)} m hits at {f(v)} m/s on both surfaces and stops on both. Why does only the concrete break it?",
        f"The egg ({f(m*1000,0)} g) loses the same {f(p,2)} kg·m/s of momentum on the concrete and on the foam. What saves it on the foam?",
        "The foam and the concrete both take all of the egg's momentum away. What is different about the foam?",
        f"Same egg, same {f(h)} m drop, same stop. What does the foam change?"]
    i=[1.0,1.5,0.8,2.0,1.2].index(h)
    return {"prompt":pr[i],"input":ch(("reduces","The foam reduces the egg's momentum"),("time","The foam increases the time of impact, reducing the force"),("gravity","The foam cancels gravity")),"answer":{"choice":"time"},"outcome":"The foam increases the time of impact, so the force on the egg is much smaller.","explanation":"Impulse = force × time = change in momentum. The change in momentum is fixed (the egg arrives with the same momentum and ends at rest), so making the stop last longer makes the force smaller. On concrete the time is tiny and the force is big enough to crack the shell.","expectedKeywords":kwi,"keywordSynonyms":syni,"coachSecrets":[],"params":{"h":h,"m":m,"tc":0.002,"tf":0.1,"surface":"both"}}
mk(S2,'dyn_2_anomaly','prediction',True,'egg',IMP,[dyn2(1.0,0.06),dyn2(1.5,0.06),dyn2(0.8,0.05),dyn2(2.0,0.06),dyn2(1.2,0.055)])
def imp1(h,m):
    v=math.sqrt(2*G*h); p=m*v
    return {"prompt":f"A {f(m*1000,0)} g egg falls {f(h)} m, reaching {f(v,2)} m/s just before it lands. Predict its momentum at that moment.","input":num(("p","Momentum","kg·m/s")),"answer":{"p":round(p,3)},"tolerance":tol(p,0.05,0.005),"outcome":f"{f(p,3)} kg·m/s, downwards.","explanation":f"p = m × v = {f(m,3)} kg × {f(v,2)} m/s = {f(p,3)} kg·m/s. Notice the mass must be in kilograms: {f(m*1000,0)} g = {f(m,3)} kg.","coachSecrets":[f(p,3)],"params":{"h":h,"m":m,"tc":0.002,"tf":0.1,"surface":"foam"}}
mk(S2,'imp_1','prediction',False,'egg',MOM,[imp1(1.0,0.06),imp1(1.25,0.05),imp1(0.8,0.06),imp1(1.8,0.055),imp1(2.0,0.06)])
def imp2(h,m,tf,tc):
    v=math.sqrt(2*G*h); p=m*v; Ff=p/tf; Fc=p/tc
    return {"prompt":f"The {f(m*1000,0)} g egg lands at {f(v,2)} m/s. The foam stops it in {f(tf,2)} s; the concrete would stop it in {f(tc,3)} s. Predict the average stopping force in each case.","input":num(("foam","Force on foam","N"),("conc","Force on concrete","N")),"answer":{"foam":round(Ff,2),"conc":round(Fc,1)},"tolerance":{"foam":tol(Ff,0.06,0.05),"conc":tol(Fc,0.06,1)},"outcome":f"Foam: {f(Ff,2)} N. Concrete: {f(Fc,0)} N, {f(tf/tc,0)} times as much.","explanation":f"Average force = change in momentum ÷ time = {f(p,3)} ÷ {f(tf,2)} = {f(Ff,2)} N on the foam, and {f(p,3)} ÷ {f(tc,3)} = {f(Fc,0)} N on concrete. A shell cracks at a few tens of newtons.","coachSecrets":[f(Ff,2)+" n",f(Fc,0)+" n"],"params":{"h":h,"m":m,"tc":tc,"tf":tf,"surface":"both"}}
mk(S2,'imp_2','prediction',False,'egg',IMP,[imp2(1.0,0.06,0.1,0.002),imp2(1.25,0.05,0.08,0.002),imp2(0.8,0.06,0.12,0.003),imp2(1.8,0.055,0.1,0.002),imp2(2.0,0.06,0.15,0.003)])
vt=[
 trm("Why do cars have crumple zones at the front?",[("time","They make the crash last longer, so the force on the passengers is smaller"),("mom","They remove the car's momentum"),("light","They make the car lighter")],"time","They make the crash last longer.","The momentum change is fixed; spreading it over more time reduces the force (impulse = F × t)."),
 trm("A cricketer pulls her hands back while catching a fast ball. Why?",[("time","It increases the time to stop the ball, reducing the force on her hands"),("mom","It increases the ball's momentum"),("grip","It makes the ball lighter")],"time","It increases the stopping time.","Same change in momentum, longer time, smaller force."),
 trm("A 1000 kg car at 20 m/s and a 2000 kg truck at 10 m/s. Which has more momentum?",[("same","They have the same momentum"),("car","The car"),("truck","The truck")],"same","The same: 20 000 kg·m/s each.","p = m × v: 1000 × 20 = 2000 × 10."),
 trm("A gun recoils when it fires a bullet. Why?",[("mom","The bullet gains forward momentum, so the gun gains equal momentum backwards"),("air","The air pushes the gun back"),("energy","The gun loses energy")],"mom","Momentum is conserved.","Total momentum was zero before firing, so the gun's backward momentum balances the bullet's forward momentum."),
 trm("A 2 kg ball's velocity changes from 3 m/s to 7 m/s. What impulse did it get?",[("eight","8 N·s"),("four","4 N·s"),("twenty","20 N·s")],"eight","8 N·s.","Impulse = change in momentum = 2 × 7 − 2 × 3 = 8 N·s."),
]
mk(S2,'tr_dyn','transfer',False,None,IMP,vt)

# =================== Tab 3: Work, Energy & Power ===================
S3={"id":"work_energy","tabName":"Work, Energy & Power","title":"The Energy Workshop","setup":"A crate on a floor with a tape measure, a big pendulum with live energy bars (potential, kinetic, electrical, heat), a generator that can be clutched onto the pendulum, an energy-chain bench, and a motor winch with a stopwatch.","trials":[]}
WRK={"name":"Work done","formula":"W = F × s (along the force)"}
EN={"name":"Mechanical energy","formula":"PE = m g h;  KE = ½ m v²"}
CON={"name":"Conservation of energy","formula":"energy in = energy out (it only changes form)"}
PWR={"name":"Power","formula":"P = W ÷ t"}
def wd1(F,s):
    W=F*s
    return {"prompt":f"You push the crate along the floor with a steady {f(F,0)} N and it moves {f(s)} m in the direction of your push. Predict the work you do.","input":num(("W","Work done","J")),"answer":{"W":round(W,2)},"tolerance":tol(W,0.03,1),"outcome":f"{f(W,0)} J.","explanation":f"Work = force × distance moved in the direction of the force = {f(F,0)} × {f(s)} = {f(W,0)} J. One joule is the work done when 1 N moves something 1 m.","coachSecrets":[f(W,0)+" j"],"params":{"F":F,"s":s}}
mk(S3,'wd_1','prediction',False,'work',WRK,[wd1(50,4),wd1(120,3),wd1(80,2.5),wd1(200,1.5),wd1(30,10)],concept(
 "Work done","In physics, work is done only when a force moves something in the direction of the force. No movement, no work, however tiring it feels. Work done is the energy transferred.",
 ["Lifting a school bag onto a desk","Pushing a stalled car down the road","A crane raising a steel beam","Not work: holding a heavy box still, pushing a wall that does not move, carrying a tray level at steady speed (the force is up, the motion is sideways)"],
 formula="W = F × s",unit="joule (J) = 1 N × 1 m",kind="Scalar"))
kww=["distance","move","zero","force"]
synw={"distance":["displacement","metres","far","no distance"],"move":["moving","moves","motion","still","does not move","didn't move","not moving","stationary"],"zero":["0","no work","none","nothing"],"force":["push","weight","effort","holding"]}
def wd2(Wt,T):
    pr=[f"You hold a {f(Wt,0)} N box perfectly still at chest height for {f(T,0)} s. Your arms ache. How much work do you do on the box?",
        f"A weightlifter holds a {f(Wt,0)} N bar above her head without moving for {f(T,0)} s. How much work does she do on the bar?",
        f"The motor holds a {f(Wt,0)} N crate at a fixed height for {f(T,0)} s. How much work does it do on the crate in that time?",
        f"A shelf bracket holds up a {f(Wt,0)} N box for {f(T,0)} s. How much work is done on the box?",
        f"You grip a {f(Wt,0)} N suitcase and stand still for {f(T,0)} s. Work done on the suitcase?"]
    i=[(200,30),(600,5),(400,20),(150,60),(250,40)].index((Wt,T))
    return {"prompt":pr[i],"input":ch(("zero","Zero"),("ft",f"{f(Wt*T,0)} J (force × time)"),("big","A lot: you feel tired")),"answer":{"choice":"zero"},"outcome":"Zero: the work meter stays at 0 J the whole time.","explanation":"Work = force × distance moved in the direction of the force. The box does not move, so the distance is zero and so is the work done on it, however big the force or long the time. Your muscles feel tired because they keep twitching and turn chemical energy into heat, but none of that goes into the box.","expectedKeywords":kww,"keywordSynonyms":synw,"coachSecrets":[],"params":{"W":Wt,"T":T}}
mk(S3,'wd_2','prediction',True,'hold',WRK,[wd2(200,30),wd2(600,5),wd2(400,20),wd2(150,60),wd2(250,40)])
def en1(m,h,where):
    if where=='low':
        p=f"Pull the {f(m)} kg pendulum bob {f(h,2)} m up (giving it potential energy) and release it. Predict what is true at the lowest point of the swing."
        a="ke"; out="Kinetic energy is maximum at the lowest point; the potential energy there is at its lowest."
    else:
        p=f"The {f(m)} kg bob is released from {f(h,2)} m and swings to the other side. Predict what is true at the moment it stops at the top of the far side."
        a="pe"; out="Potential energy is maximum: the bob is momentarily still, so its kinetic energy is zero."
    return {"prompt":p,"input":ch(("pe","Potential energy is maximum"),("ke","Kinetic energy is maximum"),("none","Energy is zero")),"answer":{"choice":a},"outcome":out,"explanation":f"At the top all {f(m*G*h,1)} J is potential energy (m g h = {f(m)} × 9.8 × {f(h,2)}). As the bob falls it speeds up and the potential energy turns into kinetic energy; at the bottom it is all kinetic. Then it climbs, slows and turns back into potential energy. The total stays the same.","coachSecrets":[],"params":{"m":m,"h":h,"gen":False}}
mk(S3,'energy_1','prediction',False,'pendulum',EN,[en1(2,0.5,'low'),en1(1,0.8,'top'),en1(3,0.4,'low'),en1(2,0.6,'top'),en1(1.5,0.45,'low')],concept(
 "Energy and its forms","Energy is the ability to do work. It comes in many forms and is constantly being changed from one form to another, but it is never created or destroyed: the total stays the same (the law of conservation of energy).",
 ["Kinetic: anything moving, a rolling ball, wind, flowing water","Gravitational potential: a raised hammer, water behind a dam, a roller coaster at the top","Elastic potential: a stretched bow, a wound spring, a squashed trampoline","Chemical: food, fuel, batteries","Electrical, light, sound, heat (thermal) and nuclear energy","Torch: chemical → electrical → light + heat","Hydro dam: potential → kinetic → electrical","Solar panel: light → electrical; plants: light → chemical","Loudspeaker: electrical → sound; microphone: sound → electrical","Car engine: chemical → heat → kinetic; brakes: kinetic → heat","Bow and arrow: elastic → kinetic; firework: chemical → light + sound + heat"],
 formula="PE = m g h;  KE = ½ m v²",unit="joule (J)",kind="Scalar"))
def en2(m,h):
    pe=m*G*h; v=math.sqrt(2*G*h)
    return {"prompt":f"The {f(m)} kg bob is pulled up {f(h,2)} m above its lowest point and released. Predict its potential energy at the top and its speed at the bottom (no friction).","input":num(("pe","Potential energy at the top","J"),("v","Speed at the bottom","m/s")),"answer":{"pe":round(pe,2),"v":round(v,2)},"tolerance":{"pe":tol(pe,0.04,0.2),"v":tol(v,0.04,0.05)},"outcome":f"{f(pe,1)} J at the top; {f(v,2)} m/s at the bottom.","explanation":f"PE = m g h = {f(m)} × 9.8 × {f(h,2)} = {f(pe,1)} J. At the bottom it is all kinetic: ½ m v² = {f(pe,1)} J, so v = √(2 g h) = √(2 × 9.8 × {f(h,2)}) = {f(v,2)} m/s. The mass cancels: a heavy and a light bob reach the same speed.","coachSecrets":[f(pe,1)+" j",f(v,2)+" m/s"],"params":{"m":m,"h":h,"gen":False}}
mk(S3,'nrg_2','prediction',False,'pendulum',EN,[en2(2,0.5),en2(1,0.8),en2(3,0.4),en2(2,0.6),en2(1.5,0.45)])
kwe=["converted","electrical","conservation","destroyed"]
syne={"converted":["changed","transformed","turned into","becomes","transfer","transferred"],"electrical":["electricity","electric","current","bulb","light","generator"],"conservation":["conserved","total stays","same total","law","constant"],"destroyed":["lost","disappear","disappears","not lost","never lost","not destroyed","created"]}
def en3(m,h,q):
    pr=["Attach a generator to the pendulum. Predict what will happen to the swing over time.",
        f"The {f(m)} kg pendulum is clutched onto a generator that lights a bulb. Released from {f(h,2)} m, what happens to its swing?",
        "A generator is connected to the swinging pendulum's pivot. What happens to the pendulum?",
        f"Released from {f(h,2)} m with the generator connected, the bob starts with {f(m*G*h,1)} J. What happens over the next few swings?",
        "Connect the generator and let the pendulum swing. Predict what you will see."][q]
    return {"prompt":pr,"input":ch(("forever","It will swing forever"),("lost","It will stop swinging because the energy is lost"),("conv","It will stop swinging because the energy is converted to electricity")),"answer":{"choice":"conv"},"outcome":"It slows down and stops, while the bulb glows: the energy bars show mechanical energy draining into the electrical and heat bars.","explanation":"Energy is never destroyed, only converted (the law of conservation of energy). Each swing the generator turns some of the pendulum's mechanical energy into electrical energy, which the bulb turns into light and heat. Add up every bar and the total is the same as at the start.","expectedKeywords":kwe,"keywordSynonyms":syne,"coachSecrets":[],"params":{"m":m,"h":h,"gen":True}}
mk(S3,'energy_2_anomaly','prediction',True,'pendulum',CON,[en3(2,0.5,0),en3(1,0.8,1),en3(3,0.4,2),en3(2,0.6,3),en3(1.5,0.45,4)])
CH={
 "dam":(["Water held high behind the dam","Water rushing down","Turbine and generator","Homes light up"],["potential","kinetic","electrical","light"]),
 "torch":(["Battery","Wires","Bulb"],["chemical","electrical","light"]),
 "solar":(["Sunlight","Solar panel","Electric fan"],["light","electrical","kinetic"]),
 "speaker":(["Music player","Loudspeaker cone","Your ear"],["electrical","kinetic","sound"]),
 "bow":(["Archer's muscles","Drawn bow","Flying arrow"],["chemical","elastic","kinetic"]),
 "kettle":(["Socket","Kettle element","Boiling water"],["electrical","heat","heat"]),
 "car":(["Petrol","Engine","Moving car"],["chemical","heat","kinetic"]),
 "plant":(["Sunlight","Leaf","Sugar in the plant"],["light","chemical","chemical"]),
 "brakes":(["Moving bicycle","Brake pads squeeze","Hot brake rim"],["kinetic","kinetic","heat"]),
 "mic":(["Your voice","Microphone","Recorder"],["sound","electrical","electrical"]),
}
def chain_label(forms):
    out=[forms[0]]
    for x in forms[1:]:
        if x!=out[-1]: out.append(x)
    return ' → '.join(out)
def en4(key,wrong1,wrong2,name,q):
    things,forms=CH[key]
    pr=[f"{name}: which chain of energy changes happens?",f"Watch the {name.lower()} on the energy bench. Which chain describes it?",f"Follow the energy through the {name.lower()}. Which chain is right?",f"{name}: where does the energy start, and what does it become?",f"Pick the energy chain for the {name.lower()}."][q]
    right=chain_label(forms)
    return {"prompt":pr,"input":ch(("a",right),("b",wrong1),("c",wrong2)),"answer":{"choice":"a"},"outcome":f"{right}.","explanation":f"{' → '.join(f'{t} ({x})' for t,x in zip(things,forms))}. Some energy is also wasted as heat (and sometimes sound) at every step, but the total is never more or less than what went in.","coachSecrets":[],"params":{"chain":key}}
mk(S3,'nrg_4','prediction',False,'chain',CON,[
 en4("dam","kinetic → potential → light","electrical → potential → kinetic","A hydro-electric dam",0),
 en4("torch","electrical → chemical → light","light → electrical → chemical","A battery torch",1),
 en4("solar","electrical → light → kinetic","heat → light → electrical","A solar-powered fan",2),
 en4("bow","kinetic → elastic → chemical","elastic → chemical → kinetic","A bow and arrow",3),
 en4("car","kinetic → heat → chemical","electrical → chemical → kinetic","A petrol car",4)],concept(
 "Energy changes (interconversion)","Every device is an energy changer: energy goes in in one form and comes out in others. Following the chain step by step shows where the energy came from and where it ends up. Most chains end with some heat, which spreads out and is hard to use again.",
 ["Hydro dam: potential → kinetic → electrical","Wind turbine: kinetic → electrical","Solar cell: light → electrical","Battery: chemical → electrical","Bulb: electrical → light + heat","Loudspeaker: electrical → sound","Microphone: sound → electrical","Electric motor: electrical → kinetic","Generator / dynamo: kinetic → electrical","Kettle / iron / heater: electrical → heat","Photosynthesis: light → chemical","Eating and running: chemical → kinetic + heat","Brakes: kinetic → heat","Catapult or bow: elastic → kinetic","Burning wood or gas: chemical → heat + light","Nuclear power: nuclear → heat → kinetic → electrical"],
 formula="energy in = useful energy out + wasted energy",kind="Scalar"))
mk(S3,'nrg_5','prediction',False,'chain',CON,[
 en4("speaker","sound → electrical → kinetic","kinetic → sound → electrical","A loudspeaker",0),
 en4("kettle","heat → electrical","chemical → heat","An electric kettle",1),
 en4("plant","chemical → light","light → heat → kinetic","A green plant",2),
 en4("brakes","heat → kinetic","kinetic → chemical","Bicycle brakes",3),
 en4("mic","electrical → sound","kinetic → light","A microphone",4)])
def pw1(m,h,t):
    W=m*G*h; P=W/t
    return {"prompt":f"The motor winch lifts a {f(m,0)} kg block {f(h)} m straight up. The stopwatch shows it takes {f(t)} s. Predict the work done and the motor's power.","input":num(("W","Work done","J"),("P","Power","W")),"answer":{"W":round(W,1),"P":round(P,1)},"tolerance":{"W":tol(W,0.04,2),"P":tol(P,0.05,1)},"outcome":f"{f(W,0)} J of work in {f(t)} s: {f(P,0)} W.","explanation":f"Work = force × distance = weight × height = {f(m,0)} × 9.8 × {f(h)} = {f(W,0)} J. Power = work ÷ time = {f(W,0)} ÷ {f(t)} = {f(P,0)} W: {f(P,0)} joules every second.","coachSecrets":[f(W,0)+" j",f(P,0)+" w"],"params":{"m":m,"h":h,"t":t}}
mk(S3,'pw_1','prediction',False,'motor',PWR,[pw1(20,3,6),pw1(50,2,5),pw1(10,4,8),pw1(40,2.5,10),pw1(25,4,4)],concept(
 "Power","Power is how fast work is done, or how fast energy is transferred. Two people climbing the same stairs do the same work, but the one who runs up is more powerful.",
 ["A 60 W bulb uses 60 J of electrical energy every second","A sprinter can produce over 1000 W for a few seconds","A car engine of 100 kW, a kettle of 2 kW","1 horsepower ≈ 746 W","Electricity bills charge in kilowatt-hours: power × time"],
 formula="P = W ÷ t",unit="watt (W) = 1 J per second",kind="Scalar"))
def pw2(m,h,t1,t2):
    P1=m*G*h/t1; P2=m*G*h/t2; right='A' if t1<t2 else 'B'
    return {"prompt":f"Motor A lifts a {f(m,0)} kg block {f(h)} m in {f(t1)} s. Motor B lifts the same block the same height in {f(t2)} s. Which statement is right?","input":ch(("A","A is more powerful: same work, less time" if right=='A' else "A is more powerful: it does more work"),("B","B is more powerful: same work, less time" if right=='B' else "B is more powerful: it does more work"),("same","They have the same power: they do the same work")),"answer":{"choice":right},"outcome":f"Motor {right}: {f(max(P1,P2),0)} W against {f(min(P1,P2),0)} W, for the same {f(m*G*h,0)} J.","explanation":f"Both do the same work, m g h = {f(m*G*h,0)} J. Power = work ÷ time, so the faster motor has more power: {f(m*G*h,0)} ÷ {f(min(t1,t2))} = {f(max(P1,P2),0)} W.","coachSecrets":[],"params":{"m":m,"h":h,"t":t1,"t2":t2}}
mk(S3,'pw_2','prediction',False,'motor',PWR,[pw2(20,3,4,8),pw2(30,2,10,5),pw2(15,4,3,6),pw2(25,2,8,4),pw2(40,1.5,5,10)])
vt=[
 trm("A waiter carries a tray level across a room at steady speed. Work done on the tray by his upward push?",[("zero","Zero: the push is up, the motion is sideways"),("lots","A lot: he walks far"),("weight","The tray's weight × the distance")],"zero","Zero.","Work needs movement in the direction of the force; the upward force and the sideways motion are at right angles."),
 trm("What energy change happens in a wind turbine?",[("ke","Kinetic → electrical"),("pe","Potential → heat"),("el","Electrical → kinetic")],"ke","Kinetic → electrical.","Moving air turns the blades, which drive a generator."),
 trm("A ball dropped from 5 m bounces up to only 3 m. Where did the missing energy go?",[("heat","Into heat and sound at the bounce"),("gone","It was destroyed"),("mass","Into the ball's mass")],"heat","Into heat and sound.","Energy is conserved: the 'lost' potential energy became heat and sound when the ball squashed and hit the floor."),
 trm("Two students climb the same stairs. One takes 10 s, the other 20 s, and they weigh the same. Compare their power.",[("double","The first has twice the power"),("same","They have the same power"),("half","The first has half the power")],"double","The first has twice the power.","Same work, half the time, so twice the power."),
 trm("A 2000 W kettle runs for 60 s. How much energy does it transfer?",[("120k","120 000 J"),("33","33 J"),("2000","2000 J")],"120k","120 000 J.","Energy = power × time = 2000 × 60 = 120 000 J."),
]
mk(S3,'tr_wep','transfer',False,None,CON,vt)

# =================== Tab 4: Measurements ===================
S4={"id":"fundamental_quantities","tabName":"Measurements","title":"The Measurement Workstation","setup":"A workstation with a digital thermometer, a stopwatch and a pendulum, a beam balance with brass masses, a spring balance, a ruler, a graduated cylinder, and a bulb circuit with an ammeter. A switch moves the whole bench from the Earth to the Moon.","trials":[]}
TMP={"name":"Temperature","formula":"T (K) = T (°C) + 273"}
TIM={"name":"Measuring time","formula":"one swing = total time ÷ number of swings"}
MAS={"name":"Mass and weight","formula":"weight W = m × g"}
LEN={"name":"Length and volume","formula":"volume of a cube = side³; 1 mL = 1 cm³"}
CUR={"name":"Electric current","formula":"I = Q ÷ t"}
def tp1(c,what):
    k=c+273
    return {"prompt":f"The digital thermometer is dipped into {what}. It reads {f(c,0)} °C. What is this temperature in kelvin, the SI unit?","input":num(("K","Temperature","K")),"answer":{"K":k},"tolerance":1,"outcome":f"{f(k,0)} K.","explanation":f"Kelvin starts at absolute zero (−273 °C), where particles have the least possible energy, and one kelvin is the same size as one degree Celsius. So T (K) = {f(c,0)} + 273 = {f(k,0)} K. Kelvin temperatures are never negative.","coachSecrets":[f(k,0)+" k"],"params":{"c":c,"what":what}}
mk(S4,'tp_1','prediction',False,'thermo',TMP,[tp1(0,"melting ice"),tp1(100,"boiling water at sea level"),tp1(37,"a cup of water at body temperature"),tp1(25,"water at room temperature"),tp1(-18,"a freezer tray of salty ice")],concept(
 "Temperature","Temperature tells you how hot or cold something is: it measures the average kinetic energy of its particles. It is not the same as heat, which is energy flowing from a hotter thing to a colder one. Heat always flows from the higher temperature to the lower.",
 ["Measured with a thermometer (liquid-in-glass, digital probe, infrared)","Water freezes at 0 °C (273 K) and boils at 100 °C (373 K) at sea level","Normal body temperature is about 37 °C (310 K)","Absolute zero: 0 K = −273 °C, the coldest possible"],
 formula="T (K) = T (°C) + 273",unit="kelvin (K), an SI base unit; also degree Celsius (°C)",kind="Scalar"))
kwt=["temperature","heat","energy","same"]
synt={"temperature":["hotness","how hot","degrees","°c","100"],"heat":["thermal energy","heat energy","internal energy"],"energy":["joules","more energy","stored energy"],"same":["equal","both","both 100","identical"]}
def tp2(c,small,big,q):
    pr=[f"A cup and a large bucket are both filled with water boiling at {f(c,0)} °C. Which has the higher temperature?",
        f"A spoonful and a saucepan of water are both at {f(c,0)} °C. Which has the higher temperature?",
        f"A small {small} and a big {big} are both at {f(c,0)} °C. Which has the higher temperature?",
        f"Two thermometers: one in a {small}, one in a {big}, both of water at {f(c,0)} °C. Which reads higher?",
        f"A {small} and a {big} of water, each at {f(c,0)} °C. Which is at the higher temperature?"][q]
    return {"prompt":pr,"input":ch(("same","Both are at the same temperature"),("big","The bigger amount"),("small","The smaller amount")),"answer":{"choice":"same"},"outcome":f"Both thermometers read {f(c,0)} °C, but the bigger amount holds far more heat energy.","explanation":"Temperature depends on the average energy of each particle, not on how many particles there are. Both waters are equally hot, so they are at the same temperature. The bucket has many more particles, so it stores much more thermal energy: it would melt far more ice.","expectedKeywords":kwt,"keywordSynonyms":synt,"coachSecrets":[],"params":{"c":c,"compare":True,"small":small,"big":big}}
mk(S4,'tp_2','prediction',True,'thermo',TMP,[tp2(100,"cup","bucket",0),tp2(80,"spoonful","saucepan",1),tp2(60,"glass","tub",2),tp2(90,"mug","pot",3),tp2(70,"beaker","bath",4)])
def tm1(L,n):
    T=2*math.pi*math.sqrt(L/G); tot=round(n*T,2); per=tot/n
    return {"prompt":f"A pendulum {f(L*100,0)} cm long swings. You start the stopwatch, count {n} complete swings (there and back) and stop it. The stopwatch reads {f(tot,2)} s. How long is one swing?","input":num(("T","Time for one swing","s")),"answer":{"T":round(per,3)},"tolerance":0.03,"outcome":f"{f(per,2)} s.","explanation":f"One swing = total time ÷ number of swings = {f(tot,2)} ÷ {n} = {f(per,2)} s. A pendulum keeps a very steady beat, which is why it was used in clocks for 300 years.","coachSecrets":[f(per,2)+" s"],"params":{"L":L,"n":n,"tot":tot}}
mk(S4,'tm_1','prediction',False,'stopwatch',TIM,[tm1(1.0,20),tm1(0.5,10),tm1(0.8,20),tm1(0.25,10),tm1(1.2,10)],concept(
 "Time","Time is measured by counting something that repeats very regularly: the Earth spinning, a pendulum swinging, a quartz crystal vibrating, or a caesium atom (which defines the second). We measure it with clocks and stopwatches.",
 ["The second is defined by 9 192 631 770 vibrations of a caesium-133 atom","Stopwatches measure to 0.01 s, but your reaction time is about 0.2 s","To time a short event, time many repeats and divide","1 minute = 60 s, 1 hour = 3600 s, 1 day = 86 400 s"],
 unit="second (s), an SI base unit",kind="Scalar"))
def tm2(n,q):
    pr=[f"Why do we time {n} swings and divide, instead of timing just one swing?","What is the main reason for timing many swings of a pendulum rather than one?",f"Timing {n} swings gives a more accurate period than timing one. Why?","A student times one swing; another times 20 and divides. Whose value is more reliable, and why?","Your reaction time is about 0.2 s. How does timing many swings help?"][q]
    return {"prompt":pr,"input":ch(("react","The reaction-time error is shared out over many swings, so it becomes small"),("slow","The pendulum slows down after many swings"),("faster","The swings get quicker, so you need more of them")),"answer":{"choice":"react"},"outcome":"Your reaction time error (about 0.2 s) is the same whether you time one swing or many, so spread over many swings it becomes tiny.","explanation":f"Starting and stopping the stopwatch each adds about 0.2 s of error. For one swing that is a big fraction; divided over {n} swings it is only {f(0.2/n,3)} s per swing.","coachSecrets":[],"params":{"L":1.0,"n":n,"tot":round(n*2*math.pi*math.sqrt(1/G),2)}}
mk(S4,'tm_2','prediction',False,'stopwatch',TIM,[tm2(20,0),tm2(10,1),tm2(20,2),tm2(20,3),tm2(10,4)])
def ms1(masses):
    m=sum(masses)
    return {"prompt":f"A metal block is placed on the left pan of the beam balance. It balances exactly when these brass masses are on the right pan: {' g + '.join(str(x) for x in masses)} g. What is the block's mass?","input":num(("m","Mass","g")),"answer":{"m":m},"tolerance":1,"outcome":f"{m} g ({f(m/1000,3)} kg).","explanation":f"A beam balance compares the block with known masses: when it is level, the masses are equal. {' + '.join(str(x) for x in masses)} = {m} g = {f(m/1000,3)} kg.","coachSecrets":[f"{m} g"],"params":{"masses":masses,"m":m}}
mk(S4,'ms_1','prediction',False,'balance',MAS,[ms1([200,50,20]),ms1([100,100,50,5]),ms1([500,200,20,10]),ms1([200,100,10]),ms1([50,20,20,5])],concept(
 "Mass","Mass is the amount of matter in an object. It is a measure of inertia (how hard it is to change its motion), and it is the same everywhere in the universe. Weight is different: it is the force of gravity on that mass, so it changes from planet to planet.",
 ["Measured with a beam balance by comparing with standard masses","1 kg is defined from the Planck constant; it used to be a platinum cylinder in Paris","An astronaut's mass is the same on Earth, the Moon and in orbit","Weight: measured in newtons with a spring balance; W = m × g, with g = 9.8 N/kg on Earth and 1.6 N/kg on the Moon"],
 formula="W = m × g",unit="kilogram (kg), an SI base unit",kind="Mass: scalar · Weight: vector"))
kwmm=["mass","weight","gravity","matter"]
synmm={"mass":["kg","kilogram","amount of stuff","inertia"],"weight":["newton","newtons","force of gravity","pull","w = mg","heaviness"],"gravity":["gravitational","g","pull of the moon","1.6","weaker","9.8"],"matter":["stuff","material","particles","amount"]}
def ms2(m,q):
    pr=["Measure the mass of the block on Earth, then on the Moon (simulated). Predict what changes.",
        f"A {f(m)} kg block is measured on the beam balance and hung from the spring balance on Earth. Then the bench moves to the Moon. Predict what changes.",
        f"An astronaut takes a {f(m)} kg rock from the Earth to the Moon. Predict what happens to its mass and weight.",
        f"On the Moon, gravity is about a sixth of the Earth's. What happens to a {f(m)} kg block's mass and weight?",
        f"Flip the switch to the Moon with the {f(m)} kg block on both balances. Predict the change."][q]
    return {"prompt":pr,"input":ch(("mass","Mass changes, weight stays the same"),("weight","Mass stays the same, weight changes"),("both","Both stay the same")),"answer":{"choice":"weight"},"outcome":f"The beam balance still balances {f(m)} kg, but the spring balance drops from {f(m*G,1)} N to {f(m*GM,1)} N.","explanation":"Mass is a fundamental scalar quantity: the amount of matter, measured in kilograms. Weight is a derived vector quantity: the force of gravity, W = m g, measured in newtons. Gravity on the Moon is about one sixth of the Earth's, so the weight falls to a sixth while the mass does not change. The beam balance still balances because gravity weakens equally on both pans.","expectedKeywords":kwmm,"keywordSynonyms":synmm,"coachSecrets":[],"params":{"m":m}}
mk(S4,'measure_1','prediction',True,'moon',MAS,[ms2(2,0),ms2(3,1),ms2(5,2),ms2(1.5,3),ms2(4,4)])
def ms3(m):
    we=m*G; wm=m*GM
    return {"prompt":f"The block's mass is {f(m)} kg. Using g = 9.8 N/kg on the Earth and 1.6 N/kg on the Moon, predict the spring balance reading in each place.","input":num(("we","Weight on Earth","N"),("wm","Weight on the Moon","N")),"answer":{"we":round(we,2),"wm":round(wm,2)},"tolerance":{"we":tol(we,0.03,0.2),"wm":tol(wm,0.04,0.1)},"outcome":f"Earth {f(we,1)} N; Moon {f(wm,1)} N; mass {f(m)} kg in both.","explanation":f"W = m × g: {f(m)} × 9.8 = {f(we,1)} N on Earth and {f(m)} × 1.6 = {f(wm,1)} N on the Moon.","coachSecrets":[f(we,1)+" n",f(wm,1)+" n"],"params":{"m":m}}
mk(S4,'ms_3','prediction',False,'moon',MAS,[ms3(2),ms3(5),ms3(1.5),ms3(3),ms3(10)])
def ln1(s):
    V=s**3
    return {"prompt":f"The ruler is laid along each edge of a cube: every edge reads {f(s)} cm. Predict the cube's volume.","input":num(("V","Volume","cm³")),"answer":{"V":round(V,3)},"tolerance":tol(V,0.03,0.2),"outcome":f"{f(V,2)} cm³ ({f(V,2)} mL).","explanation":f"Volume of a cube = side × side × side = {f(s)} × {f(s)} × {f(s)} = {f(V,2)} cm³. Read the ruler with your eye straight above the mark to avoid parallax error, and start from the zero line, not the worn end.","coachSecrets":[f(V,2)],"params":{"s":s}}
mk(S4,'ln_1','prediction',False,'ruler',LEN,[ln1(2),ln1(3),ln1(4),ln1(2.5),ln1(5)],concept(
 "Length, area and volume","Length is the distance between two points, measured with a ruler, tape, vernier caliper or micrometer. Area (length × length) and volume (length × length × length) are derived from it. The volume of an odd-shaped solid is found by how much water it pushes aside.",
 ["SI unit of length: the metre (m), defined by the distance light travels in 1/299 792 458 s","1 m = 100 cm = 1000 mm; 1 km = 1000 m","Area in m² or cm²; volume in m³ or cm³; 1 cm³ = 1 mL, 1000 cm³ = 1 L","Read a measuring cylinder at the bottom of the curved surface (meniscus), with your eye level with it"],
 unit="metre (m), an SI base unit",kind="Scalar"))
def ln2(v1,v2,what):
    return {"prompt":f"The graduated cylinder holds water up to {v1} mL. You gently lower {what} into it and the water rises to {v2} mL. What is the volume of {what}?","input":num(("V","Volume","cm³")),"answer":{"V":v2-v1},"tolerance":1,"outcome":f"{v2-v1} cm³.","explanation":f"The object pushes aside (displaces) its own volume of water: {v2} − {v1} = {v2-v1} mL, and 1 mL = 1 cm³. This works for any shape that sinks.","coachSecrets":[f"{v2-v1} cm"],"params":{"v1":v1,"v2":v2,"what":what}}
mk(S4,'ln_2','prediction',False,'cylinder',LEN,[ln2(50,77,"a small stone"),ln2(40,64,"a key"),ln2(60,68,"a metal cube 2 cm on each side"),ln2(30,57,"a 3 cm cube"),ln2(45,73,"a lump of clay")])
def cur1(I,t):
    Q=I*t
    return {"prompt":f"The ammeter, connected in series with the bulb, reads a steady {f(I,2)} A. How much charge flows through the bulb in {f(t,0)} s?","input":num(("Q","Charge","C")),"answer":{"Q":round(Q,2)},"tolerance":tol(Q,0.03,0.5),"outcome":f"{f(Q,1)} C.","explanation":f"Current is the rate of flow of charge: I = Q ÷ t, so Q = I × t = {f(I,2)} × {f(t,0)} = {f(Q,1)} C. One ampere is one coulomb passing every second.","coachSecrets":[f(Q,1)+" c"],"params":{"I":I,"t":t}}
mk(S4,'cur_1','prediction',False,'ammeter',CUR,[cur1(0.5,60),cur1(0.25,120),cur1(2,30),cur1(1.5,40),cur1(0.2,300)],concept(
 "Electric current","Electric current is the rate at which electric charge flows past a point in a circuit. It is measured with an ammeter, which must be connected in series so that all the current passes through it.",
 ["SI base unit: the ampere (A); 1 A = 1 coulomb per second","A torch bulb: about 0.3 A; a kettle: about 10 A; lightning: about 30 000 A","1 mA = 0.001 A","An ammeter in parallel would short the circuit, so it always goes in series"],
 formula="I = Q ÷ t",unit="ampere (A), an SI base unit",kind="Scalar"))
vt=[
 trm("Which of these is NOT one of the SI base quantities?",[("force","Force"),("mass","Mass"),("time","Time")],"force","Force.","Force is derived: 1 N = 1 kg·m/s². The base quantities include length, mass, time, temperature, current, amount of substance and light intensity."),
 trm("What is the SI unit of temperature?",[("K","Kelvin (K)"),("C","Degree Celsius (°C)"),("F","Degree Fahrenheit (°F)")],"K","Kelvin.","The kelvin is the SI base unit; °C is used every day and has the same step size."),
 trm("A bathroom scale shows 50 'kg' on Earth. What does it really measure, and what would it show on the Moon?",[("weight","It measures weight (force) and would show about 8 'kg'"),("mass","It measures mass and would show 50 kg"),("both","It measures both and would show 50 kg")],"weight","It measures the push of your weight and would show about a sixth.","A spring scale measures force; it is marked in kg by assuming Earth's g."),
 trm("Why is mass called a fundamental quantity but weight a derived one?",[("mass","Weight is built from mass and gravity (W = m g); mass is not built from anything else"),("bigger","Mass is bigger than weight"),("vector","Fundamental quantities are always vectors")],"mass","Weight = m × g.","Derived quantities are made by combining base quantities; weight combines mass with gravitational field strength."),
 trm("Which instrument measures electric current, and how is it connected?",[("amm","An ammeter, in series"),("volt","A voltmeter, in series"),("ammp","An ammeter, in parallel")],"amm","An ammeter, in series.","All the current must flow through it, so it goes in series."),
]
mk(S4,'tr_meas','transfer',False,None,MAS,vt)

L={"lessonId":"physics-fundamentals","type":"physics_fundamentals_sandbox","subject":"Physics","title":"Fundamental Physics & Mechanics Lab","summary":"The big ideas of physics, one at a time: scalars and vectors, distance and displacement, speed and velocity, acceleration, momentum, force, impulse, work, energy and its many forms, power, temperature, time and mass. Each idea opens with a concept card; then predict, watch the experiment and explain it in your own words.","durationMinutes":100,
 "assets":{"car":M+"car-model.glb","stopwatch":M+"clock-pickup.glb","ruler":M+"ruler.glb","spring":M+"coil-spring.glb","cradle":M+"newtons-cradle.glb","cylinder":M+"graduated-cylinder.glb","thermometer":M+"thermometer.glb","multimeter":M+"multimeter.glb","crate":M+"modular-crate.glb"},
 "config":{"enableScenarioSwitcher":True,"minExplanationWords":6,"minPredictionMs":0,"telemetryRules":{"requirePredictionBeforeAction":True,"logLatency":True,"logMeasurementValues":True}},
 "scenarios":[S1,S2,S3,S4],
 "laws":[{"id":"vector","name":"Scalars and vectors","summary":"A vector has a direction as well as a size."},{"id":"momentum","name":"Conservation of momentum","formula":"p = m v","summary":"Total momentum is unchanged in a collision."},{"id":"newton2","name":"Newton's second law","formula":"F = m a"},{"id":"impulse","name":"Impulse","formula":"F t = Δp","summary":"A longer stopping time means a smaller force."},{"id":"work","name":"Work","formula":"W = F s"},{"id":"energy","name":"Conservation of energy","summary":"Energy changes form but is never created or destroyed."},{"id":"power","name":"Power","formula":"P = W ÷ t"},{"id":"weight","name":"Mass and weight","formula":"W = m g"}],
 "uiSchema":{"hasTabs":True,"hasPredictionModal":True,"hasMeasurementTools":True,"hasPendulumSlider":True,"hasConceptCards":True}}
secrets_filter(L['scenarios'],L)
json.dump(L,open(OUT,'w'),indent=2,ensure_ascii=False)
print('questions',sum(len(s['trials']) for s in L['scenarios']),'concepts',sum(1 for s in L['scenarios'] for t in s['trials'] if 'concept' in t),'variants',sum(len(t['variants']) for s in L['scenarios'] for t in s['trials']))
for s in L['scenarios']: print(s['id'],[t['id'] for t in s['trials']])
