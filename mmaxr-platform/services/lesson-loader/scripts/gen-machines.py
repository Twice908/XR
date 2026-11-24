"""Writes data/simple-machines.json: four modules, every question with five sets of values.

Run from this folder:  python3 scripts/gen-machines.py
Answers are computed here from each set's numbers (law of the lever, pulleys, wheel and axle, inclined plane;
ideal machines with no friction), so a changed value can never leave a stale answer.
"""
import json, os
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data','simple-machines.json')
M='http://localhost:3007/assets/models/'
def ch(*pairs): return {"type":"choice","options":[{"id":i,"label":l} for i,l in pairs]}
def num(*fs): return {"type":"numeric","fields":[{"id":i,"label":l,"unit":u} for i,l,u in fs]}
def f(x,nd=1):
    x=round(x+0.0,nd); return ('%.*f'%(nd,x)).rstrip('0').rstrip('.') if nd else str(int(x))
def mk(sc,tid,kind,anomaly,action,law,variants):
    assert len(variants)==5,tid
    v0=variants[0]; t={"id":tid,"kind":kind,"anomaly":anomaly,"action":action,"law":law}
    for k in ('prompt','input','answer','tolerance','outcome','explanation','expectedKeywords','keywordSynonyms','coachSecrets'):
        if k in v0: t[k]=v0[k]
    t['params']=v0.get('params',{}); t['variants']=variants; sc['trials'].append(t)
def secrets_filter(sc,L):
    for s in sc:
        vis0=(s['setup']+L['summary']).lower()
        for t in s['trials']:
            for v in [t]+t['variants']:
                vis=(vis0+v.get('prompt','')+json.dumps(v.get('input',{}))).lower()
                if 'coachSecrets' in v: v['coachSecrets']=[x for x in v['coachSecrets'] if len(x)>=3 and x.lower() not in vis]
def trm(p,o,a,out,ex): return {"prompt":p,"input":ch(*o),"answer":{"choice":a},"outcome":out,"explanation":ex,"coachSecrets":[]}
LESS=lambda: [("less","Less effort"),("more","More effort"),("same","The same effort")]
def kws(*w):
    return list(w)

# ---------- physics (ideal machines) ----------
lever=lambda W,la,ea: W*la/ea
LEV={"name":"Law of the lever","formula":"effort × effort arm = load × load arm"}
PUL={"name":"Pulleys","formula":"effort = load ÷ n; rope pulled = n × height"}
WHL={"name":"Wheel and axle","formula":"effort = load × axle radius ÷ wheel radius"}
INC={"name":"Inclined plane","formula":"effort = load × height ÷ ramp length"}
WORK={"name":"Work is conserved","formula":"effort × distance = load × distance"}

# ======================= Tab 1: Levers =======================
S1={"id":"levers","tabName":"Levers","title":"The Lever Bench","setup":"A bar, a movable fulcrum and a load, with a force meter on the effort end. Slide the fulcrum and read the force. Real levers (a crowbar, a wheelbarrow, tweezers and more) are then set up on the bench one at a time.","trials":[]}
def l1(W,L,d1,d2):
    E1=lever(W,d1,L-d1); E2=lever(W,d2,L-d2); closer=d2<d1
    right="less" if closer else "more"
    return {"prompt":f"A {f(L)} m bar lifts a {f(W,0)} N load at one end, with you pushing down on the other end. The fulcrum is {f(d1,2)} m from the load and the force meter reads {f(E1)} N. You slide the fulcrum {'closer to' if closer else 'further from'} the load, to {f(d2,2)} m. How much effort is needed now?","input":ch(*LESS()),"answer":{"choice":right},"outcome":f"{f(E2)} N: {'less' if closer else 'more'} than the {f(E1)} N.","explanation":f"Effort × effort arm = load × load arm. Moving the fulcrum {'towards' if closer else 'away from'} the load makes the load arm {'shorter' if closer else 'longer'} and the effort arm {'longer' if closer else 'shorter'}, so the effort needed {'falls' if closer else 'rises'}: {f(W,0)} × {f(d2,2)} ÷ {f(L-d2,2)} = {f(E2)} N.","coachSecrets":[f(E2)+" n"],"params":{"W":W,"L":L,"d1":d1,"d2":d2}}
mk(S1,'lev_1','prediction',False,'lever',LEV,[l1(200,2,1.0,0.5),l1(300,3,1.2,0.6),l1(150,2.4,0.4,0.8),l1(400,2,0.8,0.4),l1(240,3,1.5,0.5)])
def l2(W,L,d):
    E=lever(W,d,L-d)
    return {"prompt":f"A {f(L)} m bar lifts a {f(W,0)} N load at one end. The fulcrum is {f(d,2)} m from the load and you push down on the far end. Predict the force meter reading.","input":num(("effort","Effort","N")),"answer":{"effort":round(E,2)},"tolerance":round(max(2,0.06*E),1),"outcome":f"{f(E)} N.","explanation":f"Effort arm = {f(L,1)} − {f(d,2)} = {f(L-d,2)} m. Effort = load × load arm ÷ effort arm = {f(W,0)} × {f(d,2)} ÷ {f(L-d,2)} = {f(E)} N.","coachSecrets":[f(E)+" n"],"params":{"W":W,"L":L,"d1":d,"d2":d}}
mk(S1,'lev_2','prediction',False,'lever',LEV,[l2(300,2,0.4),l2(200,3,0.6),l2(500,2.5,1.0),l2(120,2,1.2),l2(360,3,0.5)])
def l3(a,b,W):
    # a, b = (name, class, load arm, effort arm)
    Ea=lever(W,a[2],a[3]); Eb=lever(W,b[2],b[3])
    right='a' if Ea<Eb else 'b'
    return {"prompt":f"The same {f(W,0)} N load is lifted with a {a[0]} (a class {a[1]} lever) and with a {b[0]} (a class {b[1]} lever). Which needs less effort?","input":ch(("a",f"The {a[0]}"),("b",f"The {b[0]}"),("same","They need the same effort")),"answer":{"choice":right},"outcome":f"The {a[0] if right=='a' else b[0]}: about {f(min(Ea,Eb),0)} N, against {f(max(Ea,Eb),0)} N.","explanation":f"The effort depends on the effort arm and the load arm, not on how big the tool looks. The {a[0]} needs {f(W,0)} × {f(a[2],2)} ÷ {f(a[3],2)} = {f(Ea,0)} N and the {b[0]} needs {f(W,0)} × {f(b[2],2)} ÷ {f(b[3],2)} = {f(Eb,0)} N. A lever with the load between the fulcrum and the effort (class 2) has an effort arm longer than its load arm; one with the effort between the fulcrum and the load (class 3) has a shorter effort arm, so it needs more force.","expectedKeywords":["effort arm","load arm","fulcrum","class"],"keywordSynonyms":{"effort arm":["effort distance","distance from the fulcrum to the effort","longer arm","arm"],"load arm":["load distance","distance to the load","shorter arm"],"fulcrum":["pivot","hinge"],"class":["type","kind","class 2","class 3","second class","third class"]},"coachSecrets":[],"params":{"W":W,"aName":a[0],"aCls":a[1],"aLoad":a[2],"aEffort":a[3],"bName":b[0],"bCls":b[1],"bLoad":b[2],"bEffort":b[3]}}
WB=lambda l,e:("wheelbarrow",2,l,e); TW=lambda l,e:("pair of tweezers",3,l,e); NC=lambda l,e:("nutcracker",2,l,e); TG=lambda l,e:("pair of tongs",3,l,e); BO=lambda l,e:("bottle opener",2,l,e); FR=lambda l,e:("fishing rod",3,l,e); CB=lambda l,e:("crowbar",1,l,e)
mk(S1,'lev_3','prediction',True,'lever_pair',LEV,[l3(WB(0.5,1.4),TW(0.12,0.07),300),l3(TG(0.25,0.12),NC(0.04,0.14),40),l3(FR(1.8,0.5),BO(0.02,0.1),20),l3(CB(0.1,0.9),TG(0.22,0.1),250),l3(TW(0.1,0.06),WB(0.6,1.3),200)])
ARMS={1:(0.25,1.0),2:(0.5,1.4),3:(0.12,0.07)}
def l4(prompt,cls,out,name):
    names={1:"Class 1",2:"Class 2",3:"Class 3"}
    return {"prompt":prompt,"input":ch(("c1","Class 1"),("c2","Class 2"),("c3","Class 3")),"answer":{"choice":f"c{cls}"},"outcome":out,"explanation":{1:"A class 1 lever has the fulcrum between the load and the effort, like a seesaw or a crowbar: the effort can be smaller or larger than the load, depending on which arm is longer.",2:"A class 2 lever has the load between the fulcrum and the effort, like a wheelbarrow or a nutcracker: the effort arm is always longer than the load arm, so the effort is always smaller than the load.",3:"A class 3 lever has the effort between the fulcrum and the load, like tweezers or a fishing rod: the effort arm is shorter than the load arm, so the effort is larger than the load, but the load moves further and faster."}[cls],"coachSecrets":[],"params":{"W":200,"focus":cls,"name":name,"la":ARMS[cls][0],"ea":ARMS[cls][1]}}
v=[
 l4("A crowbar rests on a stone with its short end under a crate. You push down on the far end of the crowbar. The stone is between the crate and your hand. Which class of lever is this?",1,"Class 1: the fulcrum is in the middle.","crowbar"),
 l4("In a wheelbarrow the axle of the wheel is at one end, the load sits in the bucket in the middle, and you lift the handles at the other end. Which class of lever is it?",2,"Class 2: the load is in the middle.","wheelbarrow"),
 l4("Tweezers are hinged at one end. You squeeze them in the middle and the tips grip the object at the other end. Which class of lever are they?",3,"Class 3: the effort is in the middle.","tweezers"),
 l4("A fishing rod is held at its base, and the other hand lifts the rod part-way along, while the fish pulls on the tip. Which class of lever is it?",3,"Class 3: the effort is in the middle.","fishing rod"),
 l4("A claw hammer pulls out a nail: the head of the hammer rests on the wood, the nail is held in the claw close to the head, and you pull on the far end of the handle. The head is between the nail and your hand. Which class of lever is it?",1,"Class 1: the fulcrum is in the middle.","claw hammer"),
]
mk(S1,'lev_4','prediction',False,'lever_types',LEV,v)
def l5(name,cls,la,ea,W):
    E=lever(W,la,ea)
    where={1:"the fulcrum is between the load and your hand",2:"the load is between the fulcrum and your hand",3:"your hand is between the fulcrum and the load"}[cls]
    return {"prompt":f"A {name} is a class {cls} lever: {where}. The load of {f(W,0)} N is {f(la*100,0)} cm from the fulcrum and you apply the effort {f(ea*100,0)} cm from the fulcrum. Predict the effort.","input":num(("effort","Effort","N")),"answer":{"effort":round(E,2)},"tolerance":round(max(1,0.06*E),1),"outcome":f"{f(E)} N.","explanation":f"Effort × effort arm = load × load arm, so effort = {f(W,0)} × {f(la*100,0)} ÷ {f(ea*100,0)} = {f(E)} N. {'With the effort arm shorter than the load arm, the effort is bigger than the load.' if ea<la else 'With the effort arm longer than the load arm, the effort is smaller than the load.'}","coachSecrets":[f(E)+" n"],"params":{"W":W,"focus":cls,"name":name,"la":la,"ea":ea}}
mk(S1,'lev_5','prediction',False,'lever_types',LEV,[l5("fishing rod",3,1.8,0.5,20),l5("wheelbarrow",2,0.5,1.4,350),l5("crowbar",1,0.2,1.0,500),l5("pair of tongs",3,0.24,0.1,6),l5("nutcracker",2,0.04,0.16,120)])
vt=[
 trm("Where is the fulcrum of a seesaw?",[("mid","In the middle, between the two people"),("end","At one end"),("top","Above the plank")],"mid","In the middle.","A seesaw is a class 1 lever: the fulcrum is between the effort and the load."),
 trm("A wheelbarrow's wheel acts as the fulcrum. Where is the load?",[("between","Between the wheel and the handles"),("handles","At the handles"),("beyond","Beyond the wheel")],"between","Between the wheel and the handles.","The load is between the fulcrum (wheel) and the effort (handles): a class 2 lever."),
 trm("Which kind of lever always has a mechanical advantage less than 1?",[("c3","Class 3: the effort is between the fulcrum and the load"),("c2","Class 2: the load is between the fulcrum and the effort"),("c1","Class 1: the fulcrum is in the middle")],"c3","Class 3.","In a class 3 lever the effort arm is shorter than the load arm, so you push harder than the load but gain speed and range of movement."),
 trm("A nail is pulled out with the claw of a hammer. Which change makes it easier?",[("longer","A hammer with a longer handle"),("shorter","A hammer with a shorter handle"),("heavier","A hammer with a heavier head, same handle")],"longer","A hammer with a longer handle.","A longer handle lengthens the effort arm, so less force is needed for the same load arm."),
 trm("The effort arm of a lever is three times its load arm. How does the effort compare with the load?",[("third","A third of the load"),("three","Three times the load"),("same","The same")],"third","A third of the load.","Effort = load × load arm ÷ effort arm = load ÷ 3."),
]
mk(S1,'tr_lev','transfer',False,None,LEV,vt)

# ======================= Tab 2: Pulleys =======================
S2={"id":"pulleys","tabName":"Pulleys","title":"The Pulley Bench","setup":"One pulley fixed at the top of a frame, with a rope passing over it: the load hangs on one end and you pull the other end through a force meter. A ruler beside the frame measures how far the load rises and how much rope you pull. The last questions ask about movable pulleys and the block and tackle.","trials":[]}
FIX={"name":"The fixed pulley","formula":"effort = load; rope pulled = height lifted"}
def p1(kind,W,h=1.0):
    P={"W":W,"h":h,"compare":False}
    if kind=='same':
        return {"prompt":f"A {f(W,0)} N load hangs on one end of the rope over the fixed pulley. You pull the other end down to lift it. Compared with the load's weight, what will the force meter read?","input":ch(("same","The same as the load"),("half","About half the load"),("double","About twice the load")),"answer":{"choice":"same"},"outcome":f"About {f(W,0)} N: the same as the load.","explanation":"The rope carries the same tension all the way along, and only one rope section holds the load up. So the pull you give equals the weight of the load: a single fixed pulley gives no saving in force.","coachSecrets":[],"params":P}
    if kind=='dir':
        return {"prompt":f"You pull the free end of the rope DOWN by {f(h,1)} m. What does the {f(W,0)} N load do?","input":ch(("up","It rises"),("down","It moves down too"),("still","It stays where it is")),"answer":{"choice":"up"},"outcome":f"It rises by {f(h,1)} m.","explanation":"The rope runs over the wheel, so pulling one side down pulls the other side up. A fixed pulley changes the direction of your force: you pull down and the load goes up.","coachSecrets":[],"params":P}
    if kind=='dist':
        return {"prompt":f"With the fixed pulley you pull {f(h,1)} m of rope through your hands. How far does the {f(W,0)} N load rise?","input":ch(("same",f"{f(h,1)} m"),("half",f"{f(h/2,2)} m"),("double",f"{f(2*h,1)} m")),"answer":{"choice":"same"},"outcome":f"{f(h,1)} m: exactly as far as you pull.","explanation":"There is one rope section holding the load, so every metre you pull lifts the load one metre. No force is saved, so no distance is lost.","coachSecrets":[],"params":P}
    if kind=='why':
        return {"prompt":"A single fixed pulley does not reduce the force needed. Why do builders still use one to raise loads?","input":ch(("dir","You can pull down instead of lifting up, and use your own weight"),("half","It halves the effort"),("energy","It adds energy to the load")),"answer":{"choice":"dir"},"outcome":"It lets you pull down, which is easier and lets you use your body weight.","explanation":"The force is the same, but its direction is changed. Pulling down is more comfortable than lifting, you can stand on the ground away from the load, and you can lean your weight into the rope.","coachSecrets":[],"params":P}
    return {"prompt":f"The {f(W,0)} N load is lifted {f(h,1)} m by pulling the rope over the fixed pulley. Compared with lifting it by hand, how much work did you do?","input":ch(("same","The same work"),("less","Less work"),("more","More work")),"answer":{"choice":"same"},"outcome":f"The same: {f(W*h,0)} J either way.","explanation":"Work = force × distance. With an ideal fixed pulley the force and the distance are both the same as lifting by hand, so the work is the same.","coachSecrets":[],"params":P}
mk(S2,'pul_1','prediction',False,'pulley',FIX,[p1('same',200),p1('dir',150,1.2),p1('dist',240,1.5),p1('why',180),p1('work',120,2.0)])
def p2(kind,W,h):
    P={"W":W,"h":h,"compare":False}
    if kind=='force':
        return {"prompt":f"A {f(W,0)} N load hangs from the rope over the fixed pulley. Predict the force meter reading as you pull it up steadily.","input":num(("effort","Effort","N")),"answer":{"effort":W},"tolerance":round(max(2,0.04*W),1),"outcome":f"{f(W,0)} N.","explanation":"One rope section holds the load, so the effort equals the load.","coachSecrets":[],"params":P}
    return {"prompt":f"You want to raise a {f(W,0)} N load by {f(h,1)} m with the fixed pulley. How much rope must you pull?","input":num(("rope","Rope pulled","m")),"answer":{"rope":h},"tolerance":0.1,"outcome":f"{f(h,1)} m.","explanation":"With one supporting rope, the rope pulled equals the height lifted.","coachSecrets":[],"params":P}
mk(S2,'pul_2','prediction',False,'pulley',FIX,[p2('force',300,1),p2('rope',200,1.8),p2('force',160,1),p2('rope',250,2.4),p2('force',420,1)])
kwf=["same","direction","force","weight"]
synf={"same":["equal","no less","no saving","not less","as much"],"direction":["down","downward","way","turn","changes"],"force":["effort","pull","push","strength"],"weight":["load","body","heavy","lean"]}
def p3(W,h):
    return {"prompt":f"First you lift the {f(W,0)} N load straight up by hand, then you lift it the same height by pulling down on the rope over the fixed pulley. Which needs less force?","input":ch(("pulley","The pulley"),("hand","Lifting by hand"),("same","Both need the same force")),"answer":{"choice":"same"},"outcome":f"Both need about {f(W,0)} N: the fixed pulley saves no force at all.","explanation":"Many people expect any pulley to make lifting easier. A single fixed pulley does not: one rope section holds the load, so you still pull with the full weight. What it changes is the direction of the force, so you can pull down and use your own weight.","expectedKeywords":kwf,"keywordSynonyms":synf,"coachSecrets":[],"params":{"W":W,"h":h,"compare":True}}
mk(S2,'pul_3','prediction',True,'pulley',FIX,[p3(200,1),p3(300,1.2),p3(150,1),p3(250,1.5),p3(180,1)])
MOV={"name":"Movable pulleys","formula":"effort = load ÷ number of supporting ropes"}
def p4(W,q):
    if q=='half':
        return {"prompt":f"Now imagine a different set-up: the pulley hangs on the load itself (a movable pulley), with one end of the rope tied to the ceiling and you pulling the other end up. For a {f(W,0)} N load, what is the effort?","input":ch(("half",f"About {f(W/2,0)} N"),("same",f"About {f(W,0)} N"),("double",f"About {f(2*W,0)} N")),"answer":{"choice":"half"},"outcome":f"About {f(W/2,0)} N: half the load.","explanation":"With a movable pulley, two rope sections hold the load up and share it equally, so each carries half and your pull is half the load.","coachSecrets":[],"params":{}}
    return {"prompt":f"With a movable pulley, how much rope must you pull to raise a {f(W,0)} N load by 1 m?","input":ch(("two","2 m"),("one","1 m"),("half","0.5 m")),"answer":{"choice":"two"},"outcome":"2 m: twice the height, because each of the two supporting ropes must shorten by 1 m.","explanation":"Halving the force doubles the distance: effort × distance stays the same.","coachSecrets":[],"params":{}}
mk(S2,'pul_4','prediction',False,None,MOV,[p4(200,'half'),p4(160,'dist'),p4(240,'half'),p4(300,'dist'),p4(120,'half')])
kwp=["effort","rope","distance","force"]
synp={"effort":["pull","pulling","less force"],"rope":["string","line","cord"],"distance":["further","farther","longer","more rope","length"],"force":["effort","pull","strength"]}
def p5(n,W,h,q):
    E=W/n
    if q=='eff':
        return {"prompt":f"A block and tackle holds a {f(W,0)} N load on {n} rope sections. Compared with a single movable pulley (2 sections), what happens to the effort?","input":ch(("less","It needs even less effort"),("more","It needs more effort"),("same","It needs the same effort")),"answer":{"choice":"less"},"outcome":f"{f(E)} N: less than the {f(W/2)} N of one movable pulley.","explanation":f"With {n} supporting ropes the effort is {f(W,0)} ÷ {n} = {f(E)} N. But raising the load by {f(h,1)} m means pulling {n} × {f(h,1)} = {f(n*h,1)} m of rope: the force is gained at the cost of distance.","expectedKeywords":kwp,"keywordSynonyms":synp,"coachSecrets":[],"params":{}}
    return {"prompt":f"A block and tackle with {n} rope sections lifts a load {f(h,1)} m. How much rope must you pull compared with the height the load rises?","input":ch(("n_times",f"{n} times as much rope"),("same","The same length of rope"),("half","Half as much rope")),"answer":{"choice":"n_times"},"outcome":f"{f(n*h,1)} m of rope for a {f(h,1)} m lift.","explanation":f"Every one of the {n} supporting ropes must shorten by {f(h,1)} m, so you pull {f(n*h,1)} m. Effort falls to {f(E)} N, but the distance rises {n} times: effort × distance stays the same.","expectedKeywords":kwp,"keywordSynonyms":synp,"coachSecrets":[],"params":{}}
mk(S2,'pul_5','prediction',True,None,WORK,[p5(4,320,1,'eff'),p5(3,240,1,'dist'),p5(4,200,1.5,'dist'),p5(5,300,1,'eff'),p5(6,360,1,'dist')])
vt=[
 trm("A crane's hook block uses many pulleys. What is the benefit?",[("force","A small pull can lift a large load"),("speed","The load rises faster than the rope is pulled"),("energy","It creates extra energy")],"force","A small pull can lift a large load.","More supporting ropes divide the load, so the effort is smaller (but the rope must be pulled further)."),
 trm("A flag is raised with a fixed pulley at the top of the pole. Why use a pulley at all?",[("dir","You can pull down to raise it"),("light","It makes the flag lighter"),("half","It halves the pull")],"dir","You can pull down to raise it.","A fixed pulley changes the direction of the force."),
 trm("You pull 6 m of rope to lift a load 2 m. How many rope sections support the load (ideal pulleys)?",[("three","3"),("six","6"),("two","2")],"three","3.","Rope pulled = n × height, so n = 6 ÷ 2 = 3."),
 trm("An ideal pulley system lets 50 N lift a 200 N load. How far must you pull the rope to raise the load 1 m?",[("four","4 m"),("one","1 m"),("half","0.5 m")],"four","4 m.","Work in equals work out: 50 N × distance = 200 N × 1 m, so distance = 4 m."),
 trm("A well bucket is raised with a single fixed pulley. Compared with lifting it by hand on a rope, the pull is…",[("same","The same"),("half","Half"),("quarter","A quarter")],"same","The same.","A single fixed pulley only changes the direction of the force."),
]
mk(S2,'tr_pul','transfer',False,None,PUL,vt)

# ======================= Tab 3: Wheel and axle =======================
S3={"id":"wheel_axle","tabName":"Wheel & Axle","title":"The Wheel and Axle Bench","setup":"A well with a wheel and axle and a bucket of water, with a force meter on the wheel's rim, and a pair of screwdrivers with thin and thick handles.","trials":[]}
def w1(W,r,R):
    E=W*r/R; less=R>r
    return {"prompt":f"A bucket of water weighs {f(W,0)} N. It hangs on a rope wound round an axle of radius {f(r*100,0)} cm. You turn a wheel of radius {f(R*100,0)} cm fixed to the axle. Compared with lifting the bucket straight up by hand, how much force do you need at the rim of the wheel?","input":ch(*LESS()),"answer":{"choice":"less" if less else "more"},"outcome":f"{f(E)} N: {'less' if less else 'more'} than the {f(W,0)} N.","explanation":f"Effort × wheel radius = load × axle radius, so effort = {f(W,0)} × {f(r*100,0)} ÷ {f(R*100,0)} = {f(E)} N. A wheel bigger than the axle multiplies your force, but the rim has to move {f(R/r,1)} times as far as the rope.","coachSecrets":[f(E)+" n"],"params":{"W":W,"r":r,"R":R,"h":1.0}}
mk(S3,'whl_1','prediction',False,'wheel',WHL,[w1(120,0.05,0.2),w1(200,0.06,0.3),w1(90,0.04,0.12),w1(150,0.05,0.25),w1(160,0.08,0.04)])
def w2(W,r,R):
    E=W*r/R
    return {"prompt":f"The bucket weighs {f(W,0)} N and the axle has a radius of {f(r*100,0)} cm. You turn a wheel of radius {f(R*100,0)} cm. Predict the force meter reading at the rim.","input":num(("effort","Effort","N")),"answer":{"effort":round(E,2)},"tolerance":round(max(1,0.07*E),1),"outcome":f"{f(E)} N.","explanation":f"Effort = load × axle radius ÷ wheel radius = {f(W,0)} × {f(r*100,0)} ÷ {f(R*100,0)} = {f(E)} N.","coachSecrets":[f(E)+" n"],"params":{"W":W,"r":r,"R":R,"h":1.0}}
mk(S3,'whl_2','prediction',False,'wheel',WHL,[w2(200,0.05,0.25),w2(150,0.06,0.3),w2(240,0.04,0.2),w2(180,0.05,0.15),w2(120,0.06,0.24)])
kww=["radius","force","turn","larger"]
synw={"radius":["size","diameter","distance from the center","distance from the centre","wheel","bigger handle","lever arm"],"force":["effort","push","strength","pull","torque"],"turn":["turning","rotate","rotates","twist","twisting"],"larger":["bigger","thicker","longer","greater","more"]}
def w3(r,R1,R2,W):
    E1=W*r/R1; E2=W*r/R2; right='thick' if R2>R1 else 'thin'
    return {"prompt":f"A screw needs the same twisting effect from a screwdriver whose shaft has a radius of {f(r*1000,0)} mm. One handle has a radius of {f(R1*1000,0)} mm (thin), the other {f(R2*1000,0)} mm (thick). Which is easier to turn?","input":ch(("thin","The thin handle"),("thick","The thick handle"),("same","Both are equally easy")),"answer":{"choice":right},"outcome":f"The thick handle: about {f(E2,1)} N of grip force, against {f(E1,1)} N for the thin one.","explanation":f"The handle is the wheel and the shaft is the axle. Force at the grip = load × shaft radius ÷ handle radius, so a bigger handle radius means a smaller force: {f(W,0)} × {f(r*1000,0)} ÷ {f(R2*1000,0)} = {f(E2,1)} N for the thick handle, against {f(E1,1)} N for the thin one.","expectedKeywords":kww,"keywordSynonyms":synw,"coachSecrets":[f(E2,1)+" n"],"params":{"W":W,"r":r,"R1":R1,"R2":R2}}
mk(S3,'whl_3','prediction',True,'screwdriver',WHL,[w3(0.004,0.010,0.020,60),w3(0.003,0.008,0.016,50),w3(0.005,0.012,0.024,80),w3(0.004,0.009,0.027,45),w3(0.003,0.010,0.025,70)])
def w4(W,r,R,h):
    rope=h*R/r
    return {"prompt":f"The axle has a radius of {f(r*100,0)} cm and the wheel {f(R*100,0)} cm. You pull a rope wound round the rim of the wheel to raise the {f(W,0)} N bucket by {f(h,1)} m. How much rope must you pull off the wheel?","input":num(("rope","Rope pulled","m")),"answer":{"rope":round(rope,2)},"tolerance":round(max(0.1,0.06*rope),2),"outcome":f"{f(rope,1)} m.","explanation":f"Each turn winds {f(2*3.1416*r,2)} m onto the axle but unwinds {f(2*3.1416*R,2)} m from the wheel, {f(R/r,1)} times as much. So lifting {f(h,1)} m takes {f(h,1)} × {f(R/r,1)} = {f(rope,1)} m of rope: the force is {f(R/r,1)} times smaller, the distance {f(R/r,1)} times bigger.","coachSecrets":[f(rope,1)+" m"],"params":{"W":W,"r":r,"R":R,"h":h}}
mk(S3,'whl_4','prediction',False,'wheel',WORK,[w4(200,0.05,0.25,1),w4(150,0.06,0.3,0.8),w4(120,0.04,0.2,1),w4(240,0.05,0.15,1.2),w4(180,0.06,0.24,1)])
vt=[
 trm("You turn the handle of a door knob (a wheel and axle). Why is a big knob easier than a small one?",[("big","A bigger radius gives a longer lever arm, so less force is needed"),("small","A smaller knob is lighter"),("same","It makes no difference")],"big","A bigger radius gives a longer lever arm.","A bigger wheel multiplies your force more, because force × radius is what turns the axle."),
 trm("A water well has a crank handle of radius 30 cm and an axle of radius 5 cm. By what factor does it multiply your force?",[("six","6"),("thirty","30"),("one","1")],"six","6.","Mechanical advantage = wheel radius ÷ axle radius = 30 ÷ 5 = 6."),
 trm("A bicycle's pedal crank is a wheel and axle. The pedal turns in a big circle while the sprocket turns in a small one. What is gained and what is lost?",[("force","Force is multiplied, but the pedal moves further"),("both","Both force and distance are gained"),("none","Nothing is gained or lost")],"force","Force is multiplied, but the pedal moves further.","A bigger radius multiplies force but needs more movement."),
 trm("Why must you turn the handle of a well many times to raise the bucket a short way?",[("dist","The wheel rim moves much further than the rope winds up"),("weak","The rope is weak"),("heavy","The bucket gets heavier")],"dist","The wheel rim moves much further than the rope winds up.","What you gain in force you pay for in distance: the rim travels R ÷ r times as far as the rope."),
 trm("A steering wheel is bigger than the steering column. What does that do?",[("less","Less force is needed to turn it"),("more","More force is needed to turn it"),("none","It changes nothing")],"less","Less force is needed to turn it.","A wheel bigger than its axle multiplies the driver's force."),
]
mk(S3,'tr_whl','transfer',False,None,WHL,vt)

# ======================= Tab 4: Inclined plane =======================
S4={"id":"inclined_plane","tabName":"Inclined Plane","title":"The Ramp Bench","setup":"A heavy crate, a truck bed and a ramp whose length can change, with a force meter on the crate and a ruler for the distance it moves. The ramp is smooth.","trials":[]}
def i1(W,h,ln):
    E=W*h/ln
    return {"prompt":f"A {f(W,0)} N crate must reach a truck bed {f(h,1)} m high. You can lift it straight up, or push it up a smooth ramp {f(ln,1)} m long. Which needs less effort?","input":ch(("lift","Lifting it straight up"),("ramp","Pushing it up the ramp"),("same","The same either way")),"answer":{"choice":"ramp"},"outcome":f"The ramp: {f(E)} N, against {f(W,0)} N for lifting.","explanation":f"Lifting straight up takes a force of {f(W,0)} N over {f(h,1)} m. The ramp needs only W × h ÷ length = {f(W,0)} × {f(h,1)} ÷ {f(ln,1)} = {f(E)} N, but over {f(ln,1)} m. The same work is done with a smaller force over a longer distance.","coachSecrets":[f(E)+" n"],"params":{"W":W,"h":h,"len1":ln,"len2":ln}}
mk(S4,'inc_1','prediction',False,'ramp',INC,[i1(600,1.2,4.8),i1(800,1.0,5),i1(500,1.5,6),i1(900,1.2,3.6),i1(700,0.8,4)])
def i2(W,h,ln):
    E=W*h/ln
    return {"prompt":f"The crate weighs {f(W,0)} N and the truck bed is {f(h,1)} m high. You push the crate up a smooth ramp {f(ln,1)} m long. Predict the force meter reading.","input":num(("effort","Effort","N")),"answer":{"effort":round(E,2)},"tolerance":round(max(3,0.07*E),1),"outcome":f"{f(E)} N.","explanation":f"Effort = weight × height ÷ length = {f(W,0)} × {f(h,1)} ÷ {f(ln,1)} = {f(E)} N.","coachSecrets":[f(E)+" n"],"params":{"W":W,"h":h,"len1":ln,"len2":ln}}
mk(S4,'inc_2','prediction',False,'ramp',INC,[i2(800,1.2,4),i2(600,1.0,5),i2(1000,1.5,6),i2(500,0.8,2),i2(900,1.2,3)])
kwi=["longer","distance","force","trade"]
syni={"longer":["long","length","gentler","less steep","shallower","gradual"],"distance":["further","farther","far","push further"],"force":["effort","push","strength"],"trade":["trade-off","tradeoff","exchange","swap","price","cost","work"]}
def i3(W,h,l1_,l2_):
    E1=W*h/l1_; E2=W*h/l2_
    return {"prompt":f"You push a {f(W,0)} N crate up a {f(l1_,1)} m ramp to a {f(h,1)} m high truck bed (effort {f(E1)} N). You swap it for a longer, gentler ramp, {f(l2_,1)} m long. What happens to the effort needed?","input":ch(("less","It decreases further"),("more","It increases"),("same","It stays the same")),"answer":{"choice":"less"},"outcome":f"{f(E2)} N: less than {f(E1)} N, but the crate is pushed {f(l2_,1)} m instead of {f(l1_,1)} m.","explanation":f"Effort = weight × height ÷ length, so a longer ramp needs a smaller force: {f(W,0)} × {f(h,1)} ÷ {f(l2_,1)} = {f(E2)} N. But the crate must be pushed further. Effort × distance (about {f(W*h,0)} J) stays the same: the trade-off in every simple machine.","expectedKeywords":kwi,"keywordSynonyms":syni,"coachSecrets":[f(E2)+" n"],"params":{"W":W,"h":h,"len1":l1_,"len2":l2_}}
mk(S4,'inc_3','prediction',True,'ramp',WORK,[i3(800,1.2,3,6),i3(600,1.0,2.5,5),i3(900,1.5,4,8),i3(500,1.2,3,4.5),i3(700,1.0,2,5)])
vt=[
 trm("A ramp that is twice as long (same height) needs…",[("half","Half the force, over twice the distance"),("same","The same force"),("double","Twice the force")],"half","Half the force, over twice the distance.","Effort × distance is constant for an ideal ramp."),
 trm("A screw is a ramp wrapped round a rod. Why is a screw with closely spaced threads easier to turn in?",[("gentle","The thread is a longer, gentler ramp"),("steep","The thread is a steeper ramp"),("none","The thread spacing makes no difference")],"gentle","The thread is a longer, gentler ramp.","Closer threads mean a longer path for each rise, so less force is needed but more turns."),
 trm("A road up a mountain zigzags instead of going straight up. Why?",[("less","A longer path means a smaller force is needed"),("more","It makes the climb harder on purpose"),("none","It saves no effort at all")],"less","A longer path means a smaller force is needed.","The zigzag lengthens the slope, which reduces the force needed."),
 trm("A smooth ramp 5 m long lifts a 500 N crate by 1 m. What is the effort?",[("hundred","100 N"),("five","5 N"),("fivehundred","500 N")],"hundred","100 N.","Effort = 500 × 1 ÷ 5 = 100 N."),
 trm("Does an ideal ramp reduce the work needed to get the crate onto the truck?",[("no","No: it only reduces the force, over a longer distance"),("yes","Yes, it reduces the work needed"),("more","No: it increases the work")],"no","No: it only reduces the force.","Work = force × distance, and an ideal machine leaves it unchanged."),
]
mk(S4,'tr_inc','transfer',False,None,WORK,vt)

L={"lessonId":"simple-machines","type":"physics_simple_machines","subject":"Physics","title":"Simple Machines Lab","summary":"Levers, pulleys, a wheel and axle and an inclined plane: change the fulcrum, the ropes, the wheel or the ramp, read the force meter, and find out what you gain and what you pay for it. Predict first, then watch what really happens.","durationMinutes":50,
 "assets":{"crowbar":M+"crowbar-lever.glb","cycleWheel":M+"cycle-wheel.glb","pulley":M+"pulley.glb","ramp":M+"ramp-inclined-plane.glb","wheel":M+"wheel-big.glb","crate":M+"modular-crate.glb","wheelbarrow":M+"wheelbarrow_construction_cart.glb","tweezers":M+"realistic_tweezers.glb"},
 "config":{"enableScenarioSwitcher":True,"minExplanationWords":6,"minPredictionMs":0},
 "scenarios":[S1,S2,S3,S4],
 "laws":[{"id":"lever","name":"Law of the lever","formula":"effort × effort arm = load × load arm","summary":"The longer the effort arm compared with the load arm, the less the effort."},{"id":"pulley","name":"Pulleys","summary":"More supporting ropes means less effort and more rope pulled."},{"id":"wheel","name":"Wheel and axle","summary":"A wheel bigger than its axle multiplies your force."},{"id":"incline","name":"Inclined plane","summary":"A longer ramp needs less force over a longer distance."},{"id":"work","name":"Work is conserved","formula":"effort × distance = load × distance","summary":"A simple machine trades force for distance; it does not make work."}],
 "uiSchema":{"hasTabs":True,"hasForceMeter":True,"hasFulcrumSlider":True,"hasRampLengthSlider":True}}
secrets_filter(L['scenarios'],L)
json.dump(L,open(OUT,'w'),indent=2,ensure_ascii=False)
print('questions',sum(len(s['trials']) for s in L['scenarios']),'variants',sum(len(t['variants']) for s in L['scenarios'] for t in s['trials']))
