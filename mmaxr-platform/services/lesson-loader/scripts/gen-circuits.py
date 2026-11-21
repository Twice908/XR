"""Writes data/physics-electricity.json: three modules, every question with five sets of values.

Run from this folder:  python3 scripts/gen-circuits.py
Answers are computed here from each set's numbers (Ohm's law, two identical bulbs in series and in parallel,
heating of a fuse wire), so a changed value can never leave a stale answer.
"""
import json, os
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data','physics-electricity.json')
M='http://localhost:3007/assets/models/'

def ch(*pairs): return {"type":"choice","options":[{"id":i,"label":l} for i,l in pairs]}
def num(*fs): return {"type":"numeric","fields":[{"id":i,"label":l,"unit":u} for i,l,u in fs]}
def f(x,nd=2):
    x=round(x+0.0,nd); return ('%.*f'%(nd,x)).rstrip('0').rstrip('.') if nd else str(int(x))

def mk(scenario,tid,kind,anomaly,action,law,variants):
    assert len(variants)==5,tid
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

def trm(p,o,a,out,ex): return {"prompt":p,"input":ch(*o),"answer":{"choice":a},"outcome":out,"explanation":ex,"coachSecrets":[]}

# ======================= Tab 1: Ohm's law =======================
S1={"id":"ohms_law","tabName":"Ohm's Law","title":"The Ohm's Law Bench","setup":"A battery, a resistor and an ammeter on a breadboard. Slide the voltage and change the resistance: a V–I graph plots every reading.","trials":[]}
OHM={"name":"Ohm's law","formula":"V = I R"}
ohm_opts=lambda: [("double","About twice as much"),("half","About half as much"),("same","The same"),("triple","About three times as much")]
def o1(R,V1,k):
    V2=V1*k; I1=V1/R; I2=V2/R
    if k==2: right,word,opts="double","twice",[("double","About twice as much"),("half","About half as much"),("same","The same"),("quad","About four times as much")]
    elif k==3: right,word,opts="triple","three times",[("triple","About three times as much"),("double","About twice as much"),("same","The same"),("third","About a third as much")]
    else: right,word,opts="half","half",[("half","About half as much"),("double","About twice as much"),("same","The same"),("quarter","About a quarter as much")]
    direction="up to" if k>1 else "down to"
    return {"prompt":f"The resistor is {f(R,0)} Ω. At {f(V1,1)} V the ammeter reads {f(I1,2)} A. You slide the battery {direction} {f(V2,1)} V and keep the resistor the same. What will the ammeter read?","input":ch(*opts),"answer":{"choice":right},"outcome":f"{f(I2,2)} A: {word} the {f(I1,2)} A. Every reading lands on one straight line through the origin of the V–I graph.","explanation":"For the same resistor, current is directly proportional to voltage: I = V ÷ R. Change the voltage by a factor and the current changes by the same factor, so the V–I points make a straight line through the origin.","coachSecrets":[f(I2,2)+" a"],"params":{"R":R,"v1":V1,"v2":V2}}
v=[o1(4,2,2),o1(5,3,2),o1(10,4,3),o1(2,1.5,2),o1(8,6,0.5)]
mk(S1,'ohm_1','prediction',False,'ohm',OHM,v)

def o2(R,V):
    I=V/R
    return {"prompt":f"A {f(R,0)} Ω resistor is connected to a {f(V,1)} V battery. Predict the ammeter reading.","input":num(("current","Ammeter reading","A")),"answer":{"current":round(I,3)},"tolerance":round(max(0.03,0.06*I),3),"outcome":f"{f(I,2)} A.","explanation":f"I = V ÷ R = {f(V,1)} ÷ {f(R,0)} = {f(I,2)} A.","coachSecrets":[f(I,2)],"params":{"R":R,"v1":V/2,"v2":V}}
v=[o2(5,10),o2(20,5),o2(10,3),o2(4,12),o2(15,6)]
mk(S1,'ohm_2','prediction',False,'ohm',OHM,v)

kw3=["resistance","current","voltage","less"]
syn3={"resistance":["resistor","resist","resists","opposition","opposes"],"current":["amps","flow","flows","charge"],"voltage":["battery","volts","push","pushes"],"less":["lower","smaller","drops","decreases","reduces","fewer","falls"]}
def o3(R,V,k):
    R2=R*k; I1=V/R; I2=V/R2
    opts_map={2:("half","Current halves"),3:("third","Current falls to a third"),4:("quarter","Current falls to a quarter"),0.5:("double","Current doubles")}
    right,rl=opts_map[k]
    others=[x for x in [("half","Current halves"),("double","Current doubles"),("same","Current stays the same"),("third","Current falls to a third"),("quarter","Current falls to a quarter")] if x[0]!=right]
    opts=[(right,rl)]+[x for x in others if x[0] in ('same','double','half')][:3]
    word="more" if k<1 else "less"
    return {"prompt":f"The battery is {f(V,1)} V and the resistor is {f(R,0)} Ω: the ammeter reads {f(I1,2)} A. You keep the voltage the same and swap in a resistor of {f(R2,1)} Ω. What happens to the current?","input":ch(*opts),"answer":{"choice":right},"outcome":f"The current becomes {f(I2,2)} A. {'More' if k<1 else 'More'} resistance gave {'more' if k<1 else 'less'} current, not the other way round." if False else f"The current becomes {f(I2,2)} A: {'more resistance, less current' if k>1 else 'less resistance, more current'}.","explanation":f"I = V ÷ R. With the voltage fixed, current is inversely proportional to resistance: resistance {'opposes' } the flow, so {'raising' if k>1 else 'lowering'} it {'lowers' if k>1 else 'raises'} the current. Here {f(V,1)} ÷ {f(R2,1)} = {f(I2,2)} A. It is a common slip to think more resistance means more current.","expectedKeywords":kw3,"keywordSynonyms":syn3,"coachSecrets":[f(I2,2)+" a"],"params":{"v":V,"r1":R,"r2":R2}}
v=[o3(4,4,2),o3(5,10,2),o3(6,12,3),o3(8,8,0.5),o3(3,6,4)]
mk(S1,'ohm_3','prediction',True,'ohm_r',OHM,v)

def o4n(R,I):
    V=R*I
    return {"prompt":f"The V–I graph of a resistor is a straight line through the origin, and it passes through the point I = {f(I,2)} A, V = {f(V,1)} V. What is the resistance of the resistor?","input":num(("resistance","Resistance","Ω")),"answer":{"resistance":R},"tolerance":round(max(0.3,0.06*R),2),"outcome":f"{f(R,0)} Ω.","explanation":f"On a V–I graph the slope is V ÷ I, which is the resistance: {f(V,1)} V ÷ {f(I,2)} A = {f(R,0)} Ω.","coachSecrets":[f(R,0)+" ω"],"params":{"R":R,"point":I}}
def o4c():
    return {"prompt":"The V–I graph for a resistor is a straight line through the origin. Which quantity does its slope give?","input":ch(("res","The resistance, V ÷ I"),("pow","The power, V × I"),("charge","The charge that flows"),("cur","The current")),"answer":{"choice":"res"},"outcome":"The resistance.","explanation":"The slope is the change in voltage divided by the change in current. By Ohm's law V ÷ I is the resistance, and for an ohmic resistor it is the same everywhere on the line.","coachSecrets":[],"params":{"R":6,"point":0.5}}
v=[o4n(10,0.6),o4n(4,1.5),o4c(),o4n(25,0.2),o4n(8,0.75)]
mk(S1,'ohm_4','prediction',False,'ohm_graph',{"name":"Slope of the V–I graph","formula":"R = V / I"},v)

vt=[
 trm("A 12 V car battery pushes 3 A through a lamp. What is the lamp's resistance?",[("four","4 Ω"),("thirtysix","36 Ω"),("quarter","0.25 Ω")],"four","4 Ω.","R = V ÷ I = 12 ÷ 3 = 4 Ω."),
 trm("A device draws 0.5 A from a 6 V supply. What current does the same device draw from 12 V?",[("one","1 A"),("quarter","0.25 A"),("half","0.5 A")],"one","1 A.","Doubling the voltage doubles the current for the same resistance: 0.5 A × 2 = 1 A."),
 trm("A short thick wire and a long thin wire of the same metal are connected to the same battery in turn. Which carries more current?",[("short","The short thick wire"),("long","The long thin wire"),("same","They carry the same")],"short","The short thick wire.","A short thick wire has less resistance, so more current flows for the same voltage."),
 trm("A circuit carries 2 A. The resistance triples and the battery stays the same. What is the current now?",[("two_thirds","About 0.67 A"),("six","6 A"),("two","2 A")],"two_thirds","About 0.67 A.","I = V ÷ R, so with three times the resistance the current is a third: 2 ÷ 3 ≈ 0.67 A."),
 trm("The current through a resistor is measured at several voltages. Which graph shows that it obeys Ohm's law?",[("line","A straight line through the origin"),("curve","A curve that bends upward"),("flat","A horizontal line")],"line","A straight line through the origin.","Ohm's law says V ∝ I at constant temperature: a straight line through the origin on a V–I graph."),
]
mk(S1,'tr_ohm','transfer',False,None,{"name":"Ohm's law","formula":"V = I R"},vt)

# ======================= Tab 2: Series vs parallel =======================
S2={"id":"series_parallel","tabName":"Series vs. Parallel","title":"The Bulb Bench","setup":"Two identical bulbs and a battery on a breadboard, with a single bulb alongside for comparison. Wire the two bulbs in series or in parallel, and unscrew one.","trials":[]}
SP={"name":"Series and parallel circuits"}
def b(mode,V,R,rem=0):
    single=V*V/R
    if mode=='series':
        i=0 if rem else V/(2*R); return {"i":i,"b":(i*i*R)/single,"bat":i,"lit":not rem}
    i1=0 if rem==1 else V/R; i2=0 if rem==2 else V/R
    return {"i1":i1,"i2":i2,"b1":(i1*i1*R)/single,"b2":(i2*i2*R)/single,"bat":i1+i2}
def sp1(kind,V,R):
    P={"V":V,"R":R,"remove":0}
    if kind=='series':
        s=b('series',V,R); assert abs(s['b']-0.25)<1e-9
        return {"prompt":f"Two identical {f(R,0)} Ω bulbs are wired in series across a {f(V,1)} V battery. Compared with one bulb alone across the same battery, how bright is each of the two?","input":ch(("dim","Each is dimmer"),("same","Each is the same"),("bright","Each is brighter")),"answer":{"choice":"dim"},"outcome":"Each bulb is dimmer: about a quarter as bright as the single bulb.","explanation":"In series the two bulbs share the battery's voltage, so each gets half of it. Half the voltage gives half the current, and brightness depends on the power, which falls to a quarter.","coachSecrets":[],"params":dict(P,mode="series")}
    if kind=='parallel':
        return {"prompt":f"Two identical {f(R,0)} Ω bulbs are wired in parallel across a {f(V,1)} V battery. Compared with one bulb alone across the same battery, how bright is each of the two?","input":ch(("dim","Each is dimmer"),("same","Each is the same"),("bright","Each is brighter")),"answer":{"choice":"same"},"outcome":"Each bulb is just as bright as the single bulb.","explanation":"In parallel each bulb is connected straight across the battery, so each gets the full voltage and draws the same current as a single bulb would. The battery simply supplies twice the current.","coachSecrets":[],"params":dict(P,mode="parallel")}
    if kind=='which':
        return {"prompt":f"You have two identical {f(R,0)} Ω bulbs and a {f(V,1)} V battery. In which wiring will the bulbs be brighter?","input":ch(("series","In series"),("parallel","In parallel"),("same","The same either way")),"answer":{"choice":"parallel"},"outcome":"Brighter in parallel: full battery voltage across each bulb, instead of half.","explanation":"Each bulb gets the full battery voltage in parallel but only half in series, so parallel bulbs carry twice the current of series bulbs and are four times as bright.","coachSecrets":[],"params":dict(P,mode="parallel")}
    if kind=='s_cur':
        return {"prompt":f"A {f(V,1)} V battery drives {f(V/R,2)} A through one {f(R,0)} Ω bulb. Two identical bulbs are now wired in series with the battery. What current does the battery supply?","input":ch(("half","About half as much"),("same","About the same"),("double","About twice as much")),"answer":{"choice":"half"},"outcome":f"{f(V/(2*R),2)} A: half. The total resistance has doubled.","explanation":"In series the resistances add, so two bulbs have twice the resistance of one. For the same battery, I = V ÷ R, so the current is halved.","coachSecrets":[f(V/(2*R),2)+" a"],"params":dict(P,mode="series")}
    return {"prompt":f"A {f(V,1)} V battery drives {f(V/R,2)} A through one {f(R,0)} Ω bulb. Two identical bulbs are now wired in parallel across the battery. What current does the battery supply?","input":ch(("half","About half as much"),("same","About the same"),("double","About twice as much")),"answer":{"choice":"double"},"outcome":f"{f(2*V/R,2)} A: twice as much. Each bulb draws its own current.","explanation":"Each parallel branch draws its own current straight from the battery, so the battery supplies the sum of the two: twice the current of one bulb.","coachSecrets":[f(2*V/R,2)+" a"],"params":dict(P,mode="parallel")}
v=[sp1('series',6,6),sp1('parallel',6,6),sp1('which',9,4),sp1('s_cur',6,3),sp1('p_cur',12,6)]
mk(S2,'sp_1','prediction',False,'bulbs',SP,v)

kw2=["path","current","break","series","parallel"]
syn2={"path":["paths","route","routes","branch","branches","loop"],"current":["flow","flows","electricity","charge"],"break":["broken","breaks","gap","open","cut","stops","stopped","remove","removed","unscrew","unscrewed"],"series":["one loop","single loop","single path","one path","same loop"],"parallel":["own path","separate path","separate paths","branches","each bulb"]}
def sp2(mode,rem,kind='other'):
    V,R=6,6
    P={"V":V,"R":R,"mode":mode,"remove":rem}
    other=3-rem
    if mode=='series':
        return {"prompt":f"The two bulbs are in series and both are lit. You unscrew bulb {rem}. What happens to bulb {other}?","input":ch(("out","It goes out"),("same","It stays lit just as bright"),("brighter","It gets brighter"),("dimmer","It stays lit but dimmer")),"answer":{"choice":"out"},"outcome":f"Bulb {other} goes out too, and the ammeter reads zero.","explanation":"A series circuit has only one path for the current. Taking out any bulb breaks that path, so the current stops everywhere and both bulbs go out.","expectedKeywords":kw2,"keywordSynonyms":syn2,"coachSecrets":[],"params":P}
    if kind=='other':
        return {"prompt":f"The two bulbs are in parallel and both are lit. You unscrew bulb {rem}. What happens to bulb {other}?","input":ch(("out","It goes out"),("same","It stays lit just as bright"),("brighter","It gets brighter"),("dimmer","It stays lit but dimmer")),"answer":{"choice":"same"},"outcome":f"Bulb {other} stays lit, just as bright as before.","explanation":"Each parallel branch has its own path from the battery. Removing one bulb opens only its own branch; the other still has the full battery voltage and the same current.","expectedKeywords":kw2,"keywordSynonyms":syn2,"coachSecrets":[],"params":P}
    return {"prompt":f"The two bulbs are in parallel and the ammeter in the battery lead reads {f(2*V/R,2)} A. You unscrew bulb {rem}. What does the ammeter read now?","input":ch(("half","About half as much"),("same","The same"),("double","About twice as much"),("zero","Zero")),"answer":{"choice":"half"},"outcome":f"{f(V/R,2)} A: half. Only one branch is left drawing current.","explanation":"Each branch draws its own current. With one branch removed the battery supplies only the remaining branch's current: half the total.","expectedKeywords":kw2,"keywordSynonyms":syn2,"coachSecrets":[f(V/R,2)+" a"],"params":P}
v=[sp2('series',2),sp2('parallel',2),sp2('series',1),sp2('parallel',1),sp2('parallel',2,'ammeter')]
mk(S2,'sp_2','prediction',True,'bulbs_remove',SP,v)

def sp3(mode,V,R):
    I=V/(2*R) if mode=='series' else 2*V/R
    return {"prompt":f"Two identical {f(R,1)} Ω bulbs are wired in {mode} across a {f(V,1)} V battery, with an ammeter in the battery lead. Predict its reading.","input":num(("current","Ammeter reading","A")),"answer":{"current":round(I,3)},"tolerance":round(max(0.05,0.08*I),3),"outcome":f"{f(I,2)} A.","explanation":f"{'In series the resistances add: 2 × '+f(R,1)+' = '+f(2*R,1)+' Ω, so I = '+f(V,1)+' ÷ '+f(2*R,1) if mode=='series' else 'Each parallel bulb draws '+f(V,1)+' ÷ '+f(R,1)+' = '+f(V/R,2)+' A and the battery supplies both: 2 ×'} {'' if mode=='series' else f(V/R,2)} = {f(I,2)} A.".replace("  "," "),"coachSecrets":[f(I,2)],"params":{"V":V,"R":R,"mode":mode,"remove":0}}
v=[sp3('series',12,4),sp3('parallel',6,3),sp3('series',9,6),sp3('parallel',12,8),sp3('series',6,1.5)]
mk(S2,'sp_3','prediction',False,'bulbs_meter',SP,v)

vt=[
 trm("Why are the lights in a house wired in parallel rather than in series?",[("indep","Each light works on its own, and each gets the full voltage"),("dim","So that they are all dimmer and save energy"),("one","Because there is only one wire to the house")],"indep","Each light works on its own, and each gets the full voltage.","In parallel each lamp has its own path from the supply, so switching one off or a bulb failing does not stop the rest, and each gets the full voltage."),
 trm("A string of old Christmas-tree lights is wired in series. One bulb blows. What happens?",[("all","The whole string goes out"),("one","Only that bulb goes out"),("dim","The rest get dimmer")],"all","The whole string goes out.","A blown bulb breaks the only path for the current, so every bulb in the series string goes out."),
 trm("An ammeter measures the current in a circuit. How must it be connected?",[("series","In series with the part you are measuring"),("par","In parallel across the part you are measuring"),("any","Either way works")],"series","In series with the part you are measuring.","The ammeter must carry the same current as the component, so it goes in the same loop: in series. It has a very low resistance so it hardly changes the current."),
 trm("A voltmeter measures the voltage across a bulb. How must it be connected?",[("par","In parallel across the bulb"),("series","In series with the bulb"),("any","Either way works")],"par","In parallel across the bulb.","A voltmeter compares the two ends of a component, so it is connected across it, in parallel. It has a very high resistance so it takes almost no current."),
 trm("Two identical resistors are connected in parallel. Compared with one of them, the total resistance is…",[("half","Half as much"),("double","Twice as much"),("same","The same")],"half","Half as much.","Two equal parallel paths let twice the current flow for the same voltage, so the total resistance is half of one."),
]
mk(S2,'tr_sp','transfer',False,None,{"name":"Series and parallel circuits"},vt)

# ======================= Tab 3: Heating effect and the fuse =======================
S3={"id":"heating_fuse","tabName":"Heating Effect & Fuse","title":"The Fuse Bench","setup":"A thin fuse wire in series with a resistor and a variable voltage source, with thick copper leads and an ammeter. Raise the voltage slowly and watch the wire.","trials":[]}
JOULE={"name":"The heating effect of current","formula":"H = I²Rt"}
RF=0.5
def fz(I,RL,kind):
    Vb=I*(RL+RF)
    P={"irated":I,"rload":RL,"rfuse":RF,"thick":kind=='thick'}
    if kind=='melt':
        return {"prompt":f"A thin fuse wire rated for {f(I,0)} A is in series with a {f(RL,1)} Ω resistor. You slowly raise the voltage of the supply. What happens to the fuse wire?","input":ch(("melt","It glows red, then melts and breaks the circuit"),("cold","It gets colder"),("same","It stays just the same"),("stay","It glows but never melts, however high the voltage")),"answer":{"choice":"melt"},"outcome":f"It glows, then melts at about {f(Vb,1)} V when the current reaches {f(I,0)} A, and the circuit breaks.","explanation":"A current heats the wire it flows through. The thin fuse wire has the most resistance, so it heats the most. When the current reaches its rating the wire melts and breaks the circuit, which cuts off the current.","coachSecrets":[f(Vb,1)+" v"],"params":P}
    if kind=='after':
        return {"prompt":f"A thin fuse wire rated for {f(I,0)} A is in series with a {f(RL,1)} Ω resistor and an ammeter. The voltage is raised until the wire melts. What does the ammeter read afterwards?","input":ch(("zero","Zero"),("max","The highest value it reached"),("half","Half of the highest value")),"answer":{"choice":"zero"},"outcome":"Zero: the gap in the wire breaks the circuit.","explanation":"Once the wire has melted there is a gap in the only path, so no current can flow at all. That is how a fuse protects the rest of the circuit.","coachSecrets":[],"params":P}
    if kind=='double':
        return {"prompt":f"The current through the fuse wire is doubled, for the same length of time. What happens to the heat produced in the wire?","input":ch(("four","It becomes four times as much"),("two","It becomes twice as much"),("same","It stays the same"),("half","It halves")),"answer":{"choice":"four"},"outcome":"Four times as much.","explanation":"The heat produced is H = I²Rt. The current is squared, so twice the current gives four times the heat.","coachSecrets":[],"params":P}
    if kind=='over':
        return {"prompt":f"The fuse is rated for {f(I,0)} A. The voltage is raised until the circuit tries to carry {f(I*1.5,1)} A through it. What happens?","input":ch(("melt","The wire melts and the circuit breaks"),("fine","Nothing: it carries any current"),("brighter","The wire gets longer but keeps conducting")),"answer":{"choice":"melt"},"outcome":"The wire melts and the circuit breaks.","explanation":"A fuse wire is made to melt when the current goes above its rating. At 1.5 times the rating the heating, which goes as I², is more than twice as much, so it melts.","coachSecrets":[],"params":P}
    return {"prompt":f"A {f(I,0)} A fuse wire is in series with a {f(RL,1)} Ω resistor. Which part of the circuit warms up most as the current rises?","input":ch(("fuse","The thin fuse wire"),("lead","The thick copper connecting wires"),("same","They all warm up the same")),"answer":{"choice":"fuse"},"outcome":"The thin fuse wire.","explanation":"The same current flows through everything in the loop, but heat is I²Rt: the thin fuse wire has far more resistance than the thick leads, so it gets far hotter.","coachSecrets":[],"params":P}
v=[fz(2,4.5,'melt'),fz(3,5.5,'after'),fz(1,9.5,'double'),fz(4,2.5,'over'),fz(5,3.5,'hot')]
mk(S3,'fuse_1','prediction',False,'fuse_ramp',JOULE,v)

def fz2(I,RL):
    Vb=I*(RL+RF)
    return {"prompt":f"A {f(I,0)} A fuse wire of resistance {f(RF,1)} Ω is in series with a {f(RL,1)} Ω resistor. At what supply voltage will the fuse just blow?","input":num(("volts","Voltage","V")),"answer":{"volts":round(Vb,2)},"tolerance":round(max(0.5,0.06*Vb),2),"outcome":f"About {f(Vb,1)} V.","explanation":f"The fuse blows when the current reaches {f(I,0)} A. The total resistance is {f(RL,1)} + {f(RF,1)} = {f(RL+RF,1)} Ω, so V = I R = {f(I,0)} × {f(RL+RF,1)} = {f(Vb,1)} V.","coachSecrets":[f(Vb,1)+" v"],"params":{"irated":I,"rload":RL,"rfuse":RF,"thick":False}}
v=[fz2(2,4.5),fz2(3,5.5),fz2(1,9.5),fz2(5,3.5),fz2(4,7.5)]
mk(S3,'fuse_2','prediction',False,'fuse_ramp',{"name":"Ohm's law with the fuse","formula":"V = I R"},v)

kw3f=["thin","resistance","heat","same current"]
syn3f={"thin":["narrow","fine","small","skinny"],"resistance":["resistor","resists","resist","resistant"],"heat":["hot","hotter","heats","heating","warm","melt","melts"],"same current":["same amount of current","equal current","the current is the same","same amps","same electricity"]}
def fz3(I,RL,q):
    P={"irated":I,"rload":RL,"rfuse":RF,"thick":True}
    if q==0:
        return {"prompt":f"The same current flows through the thin {f(I,0)} A fuse wire and through the thick copper leads beside it. As the voltage rises, which one melts first?","input":ch(("fuse","The thin fuse wire"),("lead","The thick copper leads"),("both","Both together")),"answer":{"choice":"fuse"},"outcome":"The thin fuse wire melts; the thick leads stay cool.","explanation":"It is the same current in all of them, yet only the fuse wire melts. Heat is I²Rt: the thin wire has much more resistance than the thick leads, so it turns far more of the electrical energy into heat.","expectedKeywords":kw3f,"keywordSynonyms":syn3f,"coachSecrets":[],"params":P}
    if q==1:
        return {"prompt":f"Someone replaces the thin {f(I,0)} A fuse wire with a thick copper wire to stop it blowing. The voltage is raised well past the old limit. What happens to the thick wire?","input":ch(("cool","It stays cool and keeps carrying the current, so the circuit is no longer protected"),("melt","It melts at exactly the same current as the fuse wire"),("dim","The current drops to zero")),"answer":{"choice":"cool"},"outcome":"The thick wire stays cool: nothing breaks the circuit any more.","explanation":"A thick wire has very little resistance, so the same current heats it far less (H = I²Rt) and it does not melt. Then nothing cuts off a dangerous current, which is why a fuse must never be replaced with a thicker wire.","expectedKeywords":kw3f,"keywordSynonyms":syn3f,"coachSecrets":[],"params":dict(P,replaced=True)}
    if q==2:
        return {"prompt":f"The fuse wire and a thick copper lead carry the same {f(I,0)} A. The fuse wire's resistance is 50 times the lead's. How does the heat made each second in the fuse wire compare with the lead?","input":ch(("fifty","About 50 times as much"),("same","About the same"),("twice","About twice as much"),("tiny","Far less")),"answer":{"choice":"fifty"},"outcome":"About 50 times as much.","explanation":"For the same current, H = I²Rt is proportional to the resistance, so a wire with 50 times the resistance makes 50 times the heat each second.","expectedKeywords":kw3f,"keywordSynonyms":syn3f,"coachSecrets":[],"params":P}
    if q==3:
        return {"prompt":"A heater's element is made of a thin, high-resistance wire, while the cable that brings the current to it is thick copper. Both carry the same current. Which gets glowing hot?","input":ch(("element","The thin element"),("cable","The thick cable"),("both","Both equally")),"answer":{"choice":"element"},"outcome":"The thin element glows hot; the cable stays cool.","explanation":"Same current, but H = I²Rt: the element has far more resistance, so nearly all the heat is made there and the cable stays cool.","expectedKeywords":kw3f,"keywordSynonyms":syn3f,"coachSecrets":[],"params":P}
    return {"prompt":f"Two fuse wires carry the same current. Wire A is thin, wire B is thick. As the current rises towards {f(I,0)} A, which one reaches melting first?","input":ch(("A","Wire A, the thin one"),("B","Wire B, the thick one"),("same","Both together")),"answer":{"choice":"A"},"outcome":"Wire A, the thin one.","explanation":"The thin wire has the higher resistance, so it makes more heat for the same current (H = I²Rt) and reaches its melting point first.","expectedKeywords":kw3f,"keywordSynonyms":syn3f,"coachSecrets":[],"params":P}
v=[fz3(2,4.5,0),fz3(3,5.5,1),fz3(5,3.5,2),fz3(2,4.5,3),fz3(4,2.5,4)]
mk(S3,'fuse_3','prediction',True,'fuse_ramp',JOULE,v)

vt=[
 trm("A plug has a 13 A fuse. An appliance develops a fault and tries to draw 40 A. What does the fuse do?",[("melt","It melts and breaks the circuit"),("pass","It lets the current through"),("boost","It makes the current smaller but keeps it flowing")],"melt","It melts and breaks the circuit.","The fuse wire is designed to melt when the current is above its rating, which stops the flow before the cables overheat."),
 trm("A toaster draws 3 A. Which fuse should it have?",[("five","A 5 A fuse"),("one","A 1 A fuse"),("thirty","A 30 A fuse")],"five","A 5 A fuse.","The fuse must be just above the normal current, so it lets the toaster work but blows if the current becomes too large. A 1 A fuse would blow at once, a 30 A fuse would not protect it."),
 trm("In which wire of an appliance cable is the fuse placed, and how?",[("live","In the live wire, in series with the appliance"),("neutral","Across the live and neutral wires, in parallel"),("earth","In the earth wire only")],"live","In the live wire, in series with the appliance.","The fuse must carry the whole current of the appliance so it must be in series, and in the live wire so the appliance is cut off from the live supply when it blows."),
 trm("An electric kettle's element gets hot but its cable does not. Why?",[("res","The element has much more resistance, so the same current makes more heat in it"),("less","Less current flows in the cable"),("none","The cable has no resistance at all")],"res","The element has much more resistance, so the same current makes more heat in it.","The same current flows through both. H = I²Rt, so the part with the higher resistance makes far more heat."),
 trm("The current through a heater doubles. By how much does the heat it makes each second increase?",[("four","Four times"),("two","Twice"),("same","It does not change")],"four","Four times.","H = I²Rt: heat grows with the square of the current."),
]
mk(S3,'tr_fuse','transfer',False,None,{"name":"Heating effect of current","formula":"H = I²Rt"},vt)

L={"lessonId":"physics-electricity","type":"physics_circuits","subject":"Physics","title":"Electricity & Circuits Lab","summary":"Build circuits on a breadboard: see how current, voltage and resistance fit together, how two bulbs behave in series and in parallel, and why a thin wire makes a good fuse. Predict first, then watch what really happens.","durationMinutes":30,
 "assets":{"breadboard":M+"breadboard.glb","multimeter":M+"multimeter.glb"},
 "config":{"enableScenarioSwitcher":True,"minExplanationWords":6,"minPredictionMs":0},
 "scenarios":[S1,S2,S3],
 "laws":[{"id":"ohm","name":"Ohm's law","formula":"V = I R","summary":"For a resistor, current is proportional to voltage and inversely proportional to resistance."},{"id":"series_parallel","name":"Series and parallel","summary":"Series circuits have one path; parallel circuits give each part its own path."},{"id":"joule","name":"Heating effect","formula":"H = I²Rt","summary":"A current heats the wire it flows through, most where the resistance is highest."}],
 "uiSchema":{"hasTabs":True,"hasVoltageSlider":True,"hasResistanceSlider":True,"hasCircuitToggle":True,"hasAmmeterDisplay":True}}
secrets_filter(L['scenarios'],L)
json.dump(L,open(OUT,'w'),indent=2,ensure_ascii=False)
print('questions',sum(len(s['trials']) for s in L['scenarios']),'variants',sum(len(t['variants']) for s in L['scenarios'] for t in s['trials']))
