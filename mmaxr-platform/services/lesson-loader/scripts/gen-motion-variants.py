"""Writes the five sets of values for every question into data/physics-motion.json.

Run from this folder:  python3 gen-motion-variants.py
It works on the existing contract, so the questions, options and keywords stay as authored; it recomputes each
set's prompt, answer, outcome and explanation from its numbers, so a changed number can never leave a stale answer.
"""
import json, math, os
P=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data','physics-motion.json')
L=json.load(open(P))
T={t['id']:t for s in L['scenarios'] for t in s['trials']}
G=9.8; R=100/(2*math.pi)

def f(x,nd=2):
    x=round(x+0.0,nd)
    return ('%.*f'%(nd,x)).rstrip('0').rstrip('.') if nd else str(int(x))
def ch(*pairs): return {"type":"choice","options":[{"id":i,"label":l} for i,l in pairs]}
def num(*fs): return {"type":"numeric","fields":[{"id":i,"label":l,"unit":u} for i,l,u in fs]}

def setvars(tid, variants):
    t=T[tid]
    assert len(variants)==5, (tid,len(variants))
    # the first variant is also the trial's own content (older sessions fall back to it)
    v0=variants[0]
    for k in ('prompt','input','answer','tolerance','outcome','explanation','expectedKeywords','keywordSynonyms','coachSecrets'):
        if k in v0: t[k]=v0[k]
        elif k in t and k in ('tolerance','expectedKeywords','keywordSynonyms'): pass
    t['params']=v0.get('params',{})
    t['variants']=[{k:v for k,v in v.items()} for v in variants]

# ---------------- kinematics ----------------
def legs_text(legs):
    if len(legs)==1: return f"forward {f(legs[0],0)} m along the straight"
    return f"forward {f(legs[0],0)} m along the straight, then reverses {f(-legs[1],0)} m"
def kin1(legs):
    dist=sum(abs(x) for x in legs); disp=sum(legs)
    if len(legs)==1:
        ex="In a straight line in one direction, distance and displacement are the same size."
    else:
        ex=f"The odometer adds up every metre driven, in both directions ({f(abs(legs[0]),0)} + {f(abs(legs[1]),0)} = {f(dist,0)} m). Displacement is the net change in position ({f(legs[0],0)} − {f(abs(legs[1]),0)} = {f(disp,0)} m), because going backwards undoes part of the move."
    return {"prompt":f"The car drives {legs_text(legs)}. Predict the distance on the odometer and its displacement from the start.","input":num(("distance","Distance","m"),("displacement","Displacement","m")),"answer":{"distance":dist,"displacement":disp},"tolerance":3,"outcome":f"Distance {f(dist,0)} m, displacement {f(disp,0)} m.","explanation":ex,"coachSecrets":[],"params":{"legs":legs}}
setvars('kin_1',[kin1([50]),kin1([30]),kin1([40,-15]),kin1([35,-20]),kin1([45,-10])])
T['kin_1']['variants'][0]['coachSecrets']=['same size']; T['kin_1']['coachSecrets']=['same size']

def lap_desc(fr): return {1:"one complete lap",0.5:"half a lap",0.25:"a quarter of a lap",0.75:"three quarters of a lap",1.5:"one and a half laps"}[fr]
def chord(fr): return abs(2*R*math.sin(math.pi*fr))
def kin2(fr):
    d=100*fr; c=chord(fr)
    if abs(c)<1e-6:
        out=f"Distance {f(d,0)} m, displacement 0 m."
        ex="Displacement is a vector: the straight line from where you started to where you ended. Come back to the start and it is zero, even though the odometer shows the whole 100 m you travelled."
        kw=["displacement","vector","start","zero","distance"]
        syn={"vector":["direction"],"start":["starting point","same place","back where","beginning","origin"],"zero":["0","nothing","none","no change","cancels"],"displacement":["net change in position","straight line","shortest"]}
        sec=["displacement is zero","zero displacement"]
        tol={"distance":8,"displacement":2}
    else:
        out=f"Distance {f(d,0)} m, displacement {f(c,1)} m."
        ex=f"Displacement is the straight line from the start to where the car is now, not the length of the curve it followed. {lap_desc(fr).capitalize()} covers {f(d,0)} m of track, but the start and the finish are only {f(c,1)} m apart in a straight line."
        kw=["displacement","vector","straight line","distance"]
        syn={"vector":["direction"],"straight line":["shortest","direct","chord","across","start to end","from the start"],"displacement":["net change in position","how far from the start"],"distance":["odometer","path","track covered"]}
        sec=[]
        tol={"distance":8,"displacement":3}
    return {"prompt":f"Now the car drives {lap_desc(fr)} of the circular track, starting from the loop entry, and stops. Predict the distance and the displacement.","input":num(("distance","Distance","m"),("displacement","Displacement","m")),"answer":{"distance":d,"displacement":round(c,1)},"tolerance":tol,"outcome":out,"explanation":ex,"expectedKeywords":kw,"keywordSynonyms":syn,"coachSecrets":sec,"params":{"frac":fr}}
setvars('kin_2',[kin2(1),kin2(0.5),kin2(0.25),kin2(0.75),kin2(1.5)])

def kin3(fr,v):
    d=100*fr; t=d/v; c=chord(fr); vel=c/t
    return {"prompt":f"The car drives {lap_desc(fr)} again at a steady pace, taking {f(t,2)} s. Predict its average speed and its average velocity.","input":num(("speed","Average speed","m/s"),("velocity","Average velocity","m/s")),"answer":{"speed":round(v,2),"velocity":round(vel,2)},"tolerance":0.6,"outcome":f"Average speed {f(v,1)} m/s, average velocity {f(vel,1)} m/s.","explanation":f"Speed is distance over time ({f(d,0)} m ÷ {f(t,2)} s = {f(v,1)} m/s). Velocity is displacement over time ({f(c,1)} m ÷ {f(t,2)} s = {f(vel,1)} m/s)."+(" The displacement for a full lap is zero, so the average velocity is zero." if abs(c)<1e-6 else ""),"coachSecrets":[],"params":{"frac":fr,"speed":v}}
setvars('kin_3',[kin3(1,5),kin3(1,8),kin3(0.5,5),kin3(0.25,4),kin3(0.5,10)])
T['kin_3']['coachSecrets']=['velocity is zero']; T['kin_3']['variants'][0]['coachSecrets']=['velocity is zero']

lapopts=ch(("yes_direction","Yes: its direction keeps changing"),("no_steady","No: its speed is constant"),("only_straight","Only on the straight parts"))
stropts=ch(("yes_fast","Yes: it is moving fast, so it must be accelerating"),("no_steady","No: its speed and its direction are both constant"),("a_bit","Only a little, because of the road"))
def kin4(mode,v,length=None):
    if mode=='lap':
        return {"prompt":f"Watch the car drive round the loop at a steady {f(v,0)} m/s. The speedometer never changes. Is the car accelerating?","input":lapopts,"answer":{"choice":"yes_direction"},"outcome":"Yes. The speed is steady but the velocity arrow keeps turning, so the car is accelerating towards the centre.","explanation":"Velocity has a direction as well as a size. Changing direction is changing velocity, and any change in velocity is acceleration, even at constant speed.","expectedKeywords":["velocity","direction","change","acceleration"],"keywordSynonyms":{"change":["changes","changing","turning","turns","different"],"direction":["heading","way","turn"],"acceleration":["accelerating","accelerates","accelerate"],"velocity":["vector"]},"coachSecrets":["centripetal","towards the centre","toward the centre"],"params":{"mode":"lap","speed":v}}
    return {"prompt":f"Watch the car drive straight along the track at a steady {f(v,0)} m/s. The speedometer never changes. Is the car accelerating?","input":stropts,"answer":{"choice":"no_steady"},"outcome":"No. Its speed and its direction both stay the same, so its velocity does not change and the acceleration is zero.","explanation":"Acceleration is a change in velocity: a change in speed, or in direction, or both. Along a straight line at steady speed neither changes, so the acceleration is zero however fast the car goes.","expectedKeywords":["velocity","constant","acceleration","zero"],"keywordSynonyms":{"constant":["steady","unchanged","same","not changing","does not change","stays"],"zero":["0","no acceleration","none","nothing"],"acceleration":["accelerating","accelerates","accelerate"],"velocity":["speed and direction","vector"]},"coachSecrets":[],"params":{"mode":"straight","speed":v,"length":length}}
setvars('kin_4',[kin4('lap',5),kin4('straight',6,36),kin4('lap',8),kin4('straight',10,50),kin4('lap',3)])

def trk(a,b):
    h=math.hypot(a,b); h=round(h)
    return h
def trkv(a,b,rot):
    h=trk(a,b); s=a+b; d=abs(a-b)
    labs=[(f"{s} m",),(f"{h} m",),(f"{d} m",),("0 m",)]
    ids=['a','b','c','d']
    # rotate which id carries the right answer
    order=[labs[(i+rot)%4] for i in range(4)]
    opts=[{"id":ids[i],"label":order[i][0]} for i in range(4)]
    right=ids[(1-rot)%4]
    return {"prompt":f"A hiker walks {a} m north and then {b} m east. What is the size of her displacement?","input":{"type":"choice","options":opts},"answer":{"choice":right},"outcome":f"{h} m.","explanation":f"Displacement is the straight line from start to finish. The two legs are at right angles, so {a}² + {b}² = {h}²."}
setvars('tr_kin',[trkv(30,40,0),trkv(6,8,1),trkv(5,12,2),trkv(9,12,3),trkv(20,15,1)])

# ---------------- dynamics ----------------
opts1=ch(("slides","It slides away slowly"),("stays","It does not move"),("speeds","It speeds up steadily"))
def dyn1(F,m):
    lim=0.5*m*G
    if F<=lim:
        return {"prompt":f"You push the heavy crate ({m} kg) on the floor with a force of {F} N. What happens?","input":opts1,"answer":{"choice":"stays"},"outcome":f"It does not move. The floor pushes back with exactly {F} N.","explanation":"Friction from the floor grows to match your push, up to a limit. While your force is below that limit the forces cancel, so the crate has no acceleration.","expectedKeywords":["friction","force","balance","inertia"],"keywordSynonyms":{"friction":["static","rough","grip","floor"],"balance":["balanced","equal","opposite","cancel","cancels","cancelled"],"force":["push","forces"],"inertia":["resists","resist","heavy","mass"]},"coachSecrets":[],"params":{"force":F,"mass":m}}
    kin=0.4*m*G; a=(F-kin)/m
    return {"prompt":f"You push the heavy crate ({m} kg) on the floor with a force of {F} N. What happens?","input":opts1,"answer":{"choice":"speeds"},"outcome":f"It moves off and speeds up. Your {F} N beats the friction limit (about {f(lim,0)} N), and with sliding friction of {f(kin,0)} N the net force of {f(F-kin,0)} N gives it {f(a,1)} m/s².","explanation":"Friction can only match your push up to a limit. Once the force is bigger than that limit it cannot balance it, so there is a net force and the crate accelerates, F = m a.","expectedKeywords":["friction","force","net force","acceleration"],"keywordSynonyms":{"friction":["static","rough","grip","floor"],"net force":["unbalanced","resultant","leftover","left over","overcomes","beats","bigger than","greater than"],"force":["push","forces"],"acceleration":["accelerates","accelerating","speeds up","speed up"]},"coachSecrets":[],"params":{"force":F,"mass":m}}
setvars('dyn_1',[dyn1(20,80),dyn1(50,60),dyn1(100,120),dyn1(30,40),dyn1(300,40)])
T['dyn_1']['coachSecrets']=[]

optsFloat=ch(("stops","It slows down and stops soon"),("constant","It keeps going at the same speed"),("speeds","It keeps speeding up"))
def dyn2(F,m,t,numeric):
    v=F*t/m
    kw=["inertia","force","friction","constant"]
    syn={"friction":["resistance","air","drag","nothing"],"force":["push","pushes","net force"],"constant":["same speed","steady","forever","never stops","keeps moving","keeps going"],"inertia":["first law","newton"]}
    ex="Nothing pushes or drags it after the push, so there is no net force. Newton's first law: an object keeps its velocity unless a net force acts. This is inertia."
    if numeric:
        return {"prompt":f"You push the floating {m} kg crate with {F} N for {f(t,1)} s, then let go. How fast is it moving 10 seconds later?","input":num(("speed","Speed","m/s")),"answer":{"speed":round(v,2)},"tolerance":0.25,"outcome":f"{f(v,2)} m/s, the same as the instant the push ended ({F} N × {f(t,1)} s ÷ {m} kg). It never slows down.","explanation":ex+f" The push gave it a speed of {f(v,2)} m/s (F t ÷ m) and nothing changes that afterwards.","expectedKeywords":kw,"keywordSynonyms":syn,"coachSecrets":[],"params":{"force":F,"mass":m,"pushTime":t}}
    return {"prompt":f"You give the floating {m} kg crate a push of {F} N for {f(t,1)} s, then let go. What does it do afterwards?","input":optsFloat,"answer":{"choice":"constant"},"outcome":f"It drifts on at a constant {f(v,2)} m/s and never stops by itself.","explanation":ex,"expectedKeywords":kw,"keywordSynonyms":syn,"coachSecrets":["never stops","constant speed","first law"],"params":{"force":F,"mass":m,"pushTime":t}}
setvars('dyn_2',[dyn2(40,20,0.5,False),dyn2(30,15,0.8,True),dyn2(60,30,0.4,False),dyn2(25,10,1.0,True),dyn2(50,25,0.6,False)])
T['dyn_2']['coachSecrets']=['never stops','constant speed','first law']

def dynma(F,m):
    a=F/m
    return {"prompt":f"In zero gravity you push the {m} kg crate with a steady {F} N. Predict its acceleration.","input":num(("accel","Acceleration","m/s²")),"answer":{"accel":a},"tolerance":0.3,"outcome":f"{f(a,2)} m/s²: every second its speed grows by {f(a,2)} m/s.","explanation":f"Newton's second law: F = m a, so a = F ÷ m = {F} N ÷ {m} kg = {f(a,2)} m/s². The bigger the force, the bigger the acceleration; the bigger the mass, the smaller it is.","coachSecrets":[],"params":{"force":F,"mass":m}}
setvars('dyn_ma',[dynma(40,20),dynma(60,15),dynma(30,10),dynma(100,50),dynma(24,8)])
for k in ('dyn_ma',): T[k]['coachSecrets']=[]; 
T['dyn_ma']['action']='push_mass'

maOpts=ch(("double","Double"),("triple","Triple"),("same","The same"),("half","Half as big"),("third","A third as big"))
def dynma2(F,m1,m2):
    a1=F/m1; a2=F/m2; ratio=a2/a1
    rid={2:"double",3:"triple",1:"same",0.5:"half"}.get(round(ratio,3), "third" if abs(ratio-1/3)<1e-6 else None)
    assert rid, (F,m1,m2,ratio)
    return {"prompt":f"You push a {m1} kg crate with {F} N. Now you push a {m2} kg crate with the same {F} N. Compared with the {m1} kg crate, the acceleration of the {m2} kg crate is…","input":maOpts,"answer":{"choice":rid},"outcome":f"{f(a2,2)} m/s² for the {m2} kg crate, against {f(a1,2)} m/s² for the {m1} kg one.","explanation":f"a = F ÷ m. The same force on a crate with {f(m2/m1,2)} times the mass gives {f(m1/m2,2)} times the acceleration, {f(a1,2)} → {f(a2,2)} m/s². Mass is how strongly an object resists being accelerated.","coachSecrets":[],"params":{"force":F,"mass":m2}}
setvars('dyn_ma2',[dynma2(40,20,40),dynma2(60,30,10),dynma2(36,12,6),dynma2(30,15,45),dynma2(48,16,32)])
T['dyn_ma2']['coachSecrets']=[]; T['dyn_ma2']['action']='push_mass'
# fix explanations for non-simple ratios
for v in T['dyn_ma2']['variants']:
    pass

thirdKW=["third law","equal","opposite","force","mass"]
thirdSyn={"third law":["action reaction","action and reaction","newtons third","reaction force","every action"],"equal":["same size","same","equally","identical"],"opposite":["opposing","other direction","reverse","back"],"force":["push","forces","pushes"],"mass":["heavy","heavier","lighter","light","weight"]}
def dynthird(mL,mR,F):
    aL=F/mL; aR=F/mR
    return {"prompt":f"A {mR} kg crate and a {mL} kg crate float touching in space. A spring between them pushes them apart with {F} N. Which crate feels the bigger force from the spring?","input":ch(("left",f"The {mL} kg crate"),("right",f"The {mR} kg crate"),("equal","Both feel the same force, pointing in opposite directions")),"answer":{"choice":"equal"},"outcome":f"Both feel exactly {F} N, in opposite directions. The {mL} kg crate accelerates at {f(aL,2)} m/s² and the {mR} kg crate at {f(aR,2)} m/s².","explanation":"Newton's third law: when one object pushes another, the other pushes back equally hard in the opposite direction. The forces are equal, but by F = m a the lighter crate gets the bigger acceleration.","expectedKeywords":thirdKW,"keywordSynonyms":thirdSyn,"coachSecrets":["equal and opposite"],"params":{"massLeft":mL,"massRight":mR,"force":F}}
setvars('dyn_third',[dynthird(20,60,30),dynthird(10,40,20),dynthird(30,30,24),dynthird(15,45,18),dynthird(40,10,35)])
T['dyn_third']['coachSecrets']=['equal and opposite']

def elastic(m1,v1,m2): return ((m1-m2)*v1/(m1+m2), 2*m1*v1/(m1+m2))
collOpts=ch(("together","They stick together and move off slowly"),("keeps_going","The moving ball slows down but keeps going forward; the other ball shoots off faster than the first was moving"),("exchange","The moving ball stops dead; the other ball moves off at the first ball's original speed"),("bounces","The moving ball bounces back; the other ball moves off forward"))
def dyn3(m1,v1,m2):
    u1,u2=elastic(m1,v1,m2)
    ans="keeps_going" if m1>m2 else ("exchange" if m1==m2 else "bounces")
    return {"prompt":f"A {m1} kg ball rolls at {v1} m/s into a {m2} kg ball that is standing still. What happens just after they collide?","input":collOpts,"answer":{"choice":ans},"outcome":f"The {m1} kg ball moves at {f(u1,1)} m/s and the {m2} kg ball at {f(u2,1)} m/s.","explanation":f"Total momentum (mass × velocity) is conserved: {m1} × {v1} = {f(m1*v1,1)} kg·m/s before, and {m1} × {f(u1,1)} + {m2} × {f(u2,1)} = {f(m1*u1+m2*u2,1)} after. The moving ball hands over momentum, and a small mass needs a big speed to carry it.","expectedKeywords":["momentum","conserved","transfer","mass"],"keywordSynonyms":{"conserved":["conservation","conserve","same total","stays the same","total"],"transfer":["transferred","passes","passed","gives","gave","shared","handed"],"mass":["heavy","heavier","lighter","light","weight"]},"coachSecrets":[f"{f(u2,1)}",f"{f(u1,1)}"] if abs(u1)>=0.05 and abs(u2)>=0.05 else [f"{f(u2,1)}"],"params":{"m1":m1,"v1":v1,"m2":m2}}
setvars('dyn_3',[dyn3(5,4,1),dyn3(3,6,3),dyn3(2,5,6),dyn3(8,3,2),dyn3(1,6,4)])
T['dyn_3']['coachSecrets']=T['dyn_3']['variants'][0]['coachSecrets']

cradOpts=ch(("1","One"),("2","Two"),("3","Three"),("4","Four"),("5","All five"))
def dyn4(n,side):
    word={1:"one ball",2:"two balls",3:"three balls"}[n]
    other="right" if side=='left' else "left"
    return {"prompt":f"On the Newton's cradle you lift {word} on the {side} and let go. How many balls swing out on the {other}?","input":cradOpts,"answer":{"choice":str(n)},"outcome":f"{n} {'ball swings' if n==1 else 'balls swing'} out, the same number you lifted.","explanation":"Momentum and energy are both conserved. Only the same number of balls leaving at the same speed conserves both; any other number would need a different speed that breaks energy conservation.","coachSecrets":[],"params":{"n":n,"side":side}}
setvars('dyn_4',[dyn4(2,'left'),dyn4(1,'left'),dyn4(3,'left'),dyn4(2,'right'),dyn4(1,'right')])
T['dyn_4']['coachSecrets']=[]

def trd(prompt,opts,ans,outcome,expl):
    return {"prompt":prompt,"input":ch(*opts),"answer":{"choice":ans},"outcome":outcome,"explanation":expl}
setvars('tr_dyn',[
 trd("A loaded truck and a bicycle travel at the same speed. Both brake to a stop in the same time. Which needs the bigger braking force?",[("truck","The truck"),("bike","The bicycle"),("same","They need the same force")],"truck","The truck.","The truck has far more momentum (mass × velocity). Stopping it in the same time means a bigger change in momentum, so a bigger force."),
 trd("Two cars have the same mass. One travels at 60 km/h and the other at 30 km/h. Both brake to a stop in the same time. Which needs the bigger braking force?",[("fast","The car doing 60 km/h"),("slow","The car doing 30 km/h"),("same","They need the same force")],"fast","The faster car.","Twice the speed means twice the momentum to remove. Over the same time that needs twice the force: F = change in momentum ÷ time."),
 trd("A tennis ball and a bowling ball are rolled at the same speed and stopped by hand in the same time. Which needs the bigger stopping force?",[("tennis","The tennis ball"),("bowling","The bowling ball"),("same","The same force")],"bowling","The bowling ball.","The bowling ball has much more mass, so much more momentum at the same speed. Stopping it in the same time takes a bigger force."),
 trd("A truck moving at 10 m/s needs 20 s to stop with its brakes. If the brakes can only apply half the force, what happens to the stopping time?",[("double","It doubles"),("half","It halves"),("same","It stays the same")],"double","It doubles.","F = change in momentum ÷ time. The same momentum has to be removed, so half the force takes twice as long."),
 trd("A cricket fielder pulls their hands back as they catch a fast ball. Why does that help?",[("longer","It makes the stopping time longer, so the force on the hands is smaller"),("shorter","It makes the stopping time shorter, so the force is smaller"),("mass","It reduces the mass of the ball")],"longer","It makes the stopping time longer, so the force on the hands is smaller.","The ball's momentum has to go to zero either way. A longer stopping time means a smaller force, F = change in momentum ÷ time.")])
T['tr_dyn']['variants'][0]['coachSecrets']=[]
def tr3(p,o,a,out,ex): return trd(p,o,a,out,ex)
setvars('tr_third',[
 tr3("A rocket in empty space fires hot gas out of its engine. What pushes the rocket forwards?",[("gas","The gas pushing back on the rocket"),("air","The air behind it"),("nothing","Nothing: it only moves because it is already moving")],"gas","The gas pushing back on the rocket.","The engine pushes the gas backwards, so by the third law the gas pushes the rocket forwards with an equal force. Rockets work in a vacuum because they need nothing to push against except their own exhaust."),
 tr3("A swimmer pushes off the wall of a pool with her feet. Why does she move away from the wall?",[("wall","The wall pushes back on her with an equal force"),("water","The water pushes her"),("none","She has used up the wall's force")],"wall","The wall pushes back on her with an equal force.","She pushes the wall; the wall pushes her back with an equal force in the opposite direction. That reaction force is what accelerates her."),
 tr3("A heavy rifle fires a light bullet. Compare the forces on the bullet and on the rifle while the bullet is accelerated down the barrel.",[("equal","Equal in size and opposite in direction"),("bullet","The force on the bullet is bigger"),("rifle","The force on the rifle is bigger")],"equal","Equal in size and opposite in direction.","The third law: the rifle pushes the bullet forwards and the bullet pushes the rifle backwards with exactly the same force. The light bullet accelerates much more than the heavy rifle recoils because a = F ÷ m."),
 tr3("You blow up a balloon and let it go. It shoots across the room. What pushes the balloon forwards?",[("air","The air rushing out pushes back on the balloon"),("room","The air in the room pushes it"),("rubber","The rubber is stretched")],"air","The air rushing out pushes back on the balloon.","The balloon pushes air out backwards, and the air pushes the balloon forwards with an equal force: action and reaction."),
 tr3("A person stands in a small boat and throws a heavy bag out of the back. What happens to the boat?",[("forward","It moves forward"),("back","It moves backward"),("still","It stays still")],"forward","It moves forward.","The person pushes the bag backwards; the bag pushes the person and boat forwards with an equal force. The third law again.")])
T['tr_third']['variants'][0]['coachSecrets']=[]

# ---------------- gravitation ----------------
def fall_air(h,vt):
    dt=1/480; y=0; v=0; n=0
    while y<h and n<60*480:
        a=G*(1-(v/vt)**2); v+=a*dt; y+=v*dt; n+=1
    return n*dt
def grav1(h):
    tb=fall_air(h,60); tf=fall_air(h,1.1)
    return {"prompt":f"In the AIR tube you release a metal ball and a feather together from {f(h,1)} m above the bottom. Which reaches the bottom first?","input":ch(("ball","The metal ball"),("feather","The feather"),("same","They land together")),"answer":{"choice":"ball"},"outcome":f"The metal ball lands first, after {f(tb,2)} s; the feather floats down and takes {f(tf,1)} s.","explanation":"Air pushes back on the feather much more than on the dense ball, so the feather falls slowly.","coachSecrets":[],"params":{"height":h}}
setvars('grav_1',[grav1(4.9),grav1(3.6),grav1(2.5),grav1(4.2),grav1(1.6)])
T['grav_1']['coachSecrets']=[]
def grav2(h):
    t=math.sqrt(2*h/G)
    return {"prompt":f"In the VACUUM tube you release the metal ball and the feather together from {f(h,1)} m above the bottom. Which reaches the bottom first?","input":ch(("ball","The metal ball"),("feather","The feather"),("same","They land together")),"answer":{"choice":"same"},"outcome":f"They land at exactly the same moment, after {f(t,2)} s.","explanation":"Gravity accelerates every object at the same rate, about 9.8 m/s², whatever its mass. The feather only fell slowly in air because of air resistance.","expectedKeywords":["gravity","acceleration","air resistance","same"],"keywordSynonyms":{"gravity":["gravitational","9.8","g"],"acceleration":["accelerates","accelerate","rate"],"air resistance":["air","drag"],"same":["equal","equally","together","identical"]},"coachSecrets":[],"params":{"height":h}}
setvars('grav_2',[grav2(4.9),grav2(3.0),grav2(4.4),grav2(2.2),grav2(3.6)])
T['grav_2']['coachSecrets']=[]
def grav3(h):
    t=math.sqrt(2*h/G)
    return {"prompt":f"The ball is released {f(h,2)} m above the bottom of the vacuum tube. How many seconds until it reaches the bottom? Use g ≈ 9.8 m/s² and h = ½ g t².","input":num(("time","Time to fall","s")),"answer":{"time":round(t,2)},"tolerance":0.25,"outcome":f"{f(t,2)} s.","explanation":f"h = ½ g t² gives t = √(2 × {f(h,2)} ÷ 9.8) = {f(t,2)} s. The feather takes the same.","coachSecrets":[],"params":{"height":h}}
setvars('grav_3',[grav3(4.9),grav3(1.225),grav3(2.2),grav3(3.6),grav3(4.0)])
T['grav_3']['coachSecrets']=[]

def frac_label(x):
    table={0.25:"a quarter",1/9:"a ninth",1/16:"a sixteenth",0.5:"a half",1/3:"a third",4:"four times",9:"nine times",2:"double",3:"triple",16:"sixteen times",1/4:"a quarter"}
    for k,v in table.items():
        if abs(k-x)<1e-9: return v
    return f(x,2)+" times"
def grav_f1(r0,k):
    r1=r0*k; F=1/(k*k)
    def lab(x):
        if x==0.5: return "It halves"
        if x<1: return f"It falls to {frac_label(x)}"
        if x==1: return "It stays the same"
        return f"It becomes {frac_label(x)} bigger" if x not in (2,3) else ("It doubles" if x==2 else "It triples")
    right=1/(k*k); lin=1/k; prop=k
    cand=[("right",right),("linear",lin),("prop",prop),("same",1.0)]
    seen=[];opts=[]
    for i,x in cand:
        if any(abs(x-y)<1e-9 for y in seen): continue
        seen.append(x); opts.append((i,lab(x)))
    # make sure there are always 4 options
    extra=[0.5,2,1/3,3,4]
    for x in extra:
        if len(opts)>=4: break
        if not any(abs(x-y)<1e-9 for y in seen): seen.append(x); opts.append((f"x{x}",lab(x)))
    return {"prompt":f"Two masses attract each other with a force F = G m₁ m₂ / r². They start {f(r0,1)} m apart and you move them until they are {f(r1,1)} m apart. What happens to the force?","input":ch(*opts),"answer":{"choice":"right"},"outcome":f"{lab(right).replace('It becomes','The force becomes').replace('It falls to','The force falls to').replace('It halves','The force halves').replace('It doubles','The force doubles').replace('It triples','The force triples')}. The distance changed by a factor of {f(k,2)}, so the pull changed by {f(F,3)}.","explanation":f"Gravity follows an inverse-square law: F is proportional to 1/r². Multiplying r by {f(k,2)} multiplies r² by {f(k*k,2)}, so the force is multiplied by {f(F,3)}.","expectedKeywords":["inverse square","distance","force"],"keywordSynonyms":{"inverse square":["square of the distance","r squared","distance squared","squared","one over r squared","1/r2"],"distance":["apart","further","farther","closer","separation","r"],"force":["attraction","gravity","pull","gravitational"]},"coachSecrets":[],"params":{"r0":r0,"factor":k}}
setvars('grav_f1',[grav_f1(3,2),grav_f1(3,3),grav_f1(4,0.5),grav_f1(2,4),grav_f1(6,1/3)])
T['grav_f1']['coachSecrets']=[]
for v in T['grav_f1']['variants']:
    pass

f2opts=ch(("quarter","It falls to a quarter"),("half","It halves"),("same","It stays the same"),("x2","It doubles"),("x3","It triples"),("x4","It becomes four times bigger"))
def grav_f2(kA,kB,kr,desc):
    F=kA*kB/(kr*kr)
    idm={0.25:"quarter",0.5:"half",1:"same",2:"x2",3:"x3",4:"x4"}
    return {"prompt":f"The two masses start at their original distance. Now {desc}. What happens to the force between them?","input":f2opts,"answer":{"choice":idm[F]},"outcome":f"The force becomes {f(F,2)} times what it was.","explanation":f"F = G m₁ m₂ / r² is proportional to each mass and to 1/r². Here the masses change it by {f(kA*kB,2)} and the distance by 1/{f(kr*kr,2)}, so F changes by {f(F,2)}. Both bodies always feel equal pulls.","coachSecrets":[],"params":{"massA":kA,"massB":kB,"distance":kr}}
setvars('grav_f2',[grav_f2(1,2,1,"one of the masses is doubled"),grav_f2(3,1,1,"one of the masses is tripled"),grav_f2(0.5,1,1,"one of the masses is halved"),grav_f2(2,2,1,"both masses are doubled"),grav_f2(2,1,2,"one mass is doubled and the distance is doubled")])
T['grav_f2']['coachSecrets']=[]

Gc=6.67e-11
PL={'earth':("Earth",5.97e24,6.37e6,0x2f7bd8),'moon':("the Moon",7.35e22,1.74e6,0xbfbfbf),'mars':("Mars",6.42e23,3.39e6,0xc1440e),'venus':("Venus",4.87e24,6.05e6,0xe3bb76),'jupiter':("Jupiter",1.90e27,6.99e7,0xc99b6b)}
def sci(x):
    e=int(math.floor(math.log10(x))); m=x/10**e
    sup=str(e).translate(str.maketrans("-0123456789","⁻⁰¹²³⁴⁵⁶⁷⁸⁹"))
    return f"{m:.2f} × 10{sup}"
def grav_f3(key,m):
    nm,M,Rr,col=PL[key]
    F=Gc*M*m/Rr**2
    where = "at Earth's surface" if key=='earth' else f"on the surface of {nm}"
    return {"prompt":f"A {m} kg ball sits {where}. Use F = G m₁ m₂ / r² with G = 6.67 × 10⁻¹¹ N·m²/kg², {'Earth' if key=='earth' else nm.replace('the ','')}'s mass {sci(M)} kg and radius {sci(Rr)} m. What is the gravitational force on the ball?","input":num(("force","Force","N")),"answer":{"force":round(F,2)},"tolerance":round(max(0.4,0.05*F),2),"outcome":f"About {f(F,1)} N. Divide by the ball's {m} kg and you get {f(F/m,2)} m/s², the strength of gravity there.","explanation":f"F = (6.67×10⁻¹¹ × {sci(M)} × {m}) ÷ ({sci(Rr)})² ≈ {f(F,2)} N. Dividing by the ball's mass gives g = {f(F/m,2)} m/s² for {nm}.","coachSecrets":[],"params":{"planet":key,"mass":m,"M":M,"R":Rr,"color":col}}
setvars('grav_f3',[grav_f3('earth',1),grav_f3('moon',1),grav_f3('mars',2),grav_f3('venus',1),grav_f3('jupiter',1)])
T['grav_f3']['coachSecrets']=[]
for v in T['grav_f3']['variants']: v['outcome']=v['outcome']

def trg(p,o,a,out,ex): return trd(p,o,a,out,ex)
setvars('tr_grav',[
 trg("An astronaut on the Moon (no air) drops a hammer and a feather from the same height at the same time. What happens?",[("hammer","The hammer lands first"),("feather","The feather lands first"),("same","They land together")],"same","They land together.","With no air there is no air resistance, so gravity accelerates both equally. This was demonstrated on the Moon in 1971."),
 trg("In a large vacuum chamber on Earth you release a 10 kg anvil and a 1 g coin together. What happens?",[("anvil","The anvil lands first"),("coin","The coin lands first"),("same","They land together")],"same","They land together.","With no air, only gravity acts, and gravity accelerates every object at the same rate whatever its mass. The anvil's bigger weight is cancelled by its bigger mass."),
 trg("A skydiver and a feather are released from the same plane at the same time, in normal air. Which reaches the ground first?",[("skydiver","The skydiver"),("feather","The feather"),("same","They land together")],"skydiver","The skydiver.","Air resistance matters. It slows the feather far more than it slows the dense, heavy skydiver, so the skydiver lands first."),
 trg("Astronaut Alan Shepard hit a golf ball on the Moon and dropped another one at the same moment. Which ball hit the ground first?",[("dropped","The dropped ball"),("hit","The ball he hit"),("same","They landed together")],"same","They landed together.","The sideways speed of the hit ball does not change how fast it falls. Vertical motion depends only on gravity, the same for both."),
 trg("Two stones, one with ten times the mass of the other, are dropped from the same height in a vacuum. How do their accelerations compare?",[("same","They are the same"),("heavy","The heavy stone accelerates ten times faster"),("light","The light stone accelerates faster")],"same","They are the same.","The heavy stone is pulled ten times harder, but it also has ten times the mass, so by F = m a the acceleration is identical, 9.8 m/s².")])
T['tr_grav']['variants'][0]['coachSecrets']=[]

# a coach secret that the student can already read (in the question or its options) protects nothing
S={sc['id']:sc for sc in L['scenarios']}
for sc in L['scenarios']:
    for t in sc['trials']:
        vis0=(sc['setup']+L['summary']).lower()
        for v in [t]+t.get('variants',[]):
            vis=(vis0+v.get('prompt','')+json.dumps(v.get('input',{}))).lower()
            if 'coachSecrets' in v:
                v['coachSecrets']=[x for x in v['coachSecrets'] if len(x)>=3 and x.lower() not in vis]
L['durationMinutes']=40
json.dump(L,open(P,'w'),indent=2,ensure_ascii=False)
print('ok', sum(len(t.get('variants',[])) for t in T.values()))
