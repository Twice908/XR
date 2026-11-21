"""Writes data/matter-properties.json: three modules, every question with five sets of values.

Run from this folder:  python3 gen-matter.py
Answers are computed here from each set's numbers (heating curves, densities, layering), so a changed value
can never leave a stale answer.
"""
import json, os, itertools
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','data','matter-properties.json')
M='http://localhost:3007/assets/models/'

def ch(*pairs): return {"type":"choice","options":[{"id":i,"label":l} for i,l in pairs]}
def num(*fs): return {"type":"numeric","fields":[{"id":i,"label":l,"unit":u} for i,l,u in fs]}
def f(x,nd=2):
    x=round(x+0.0,nd); return ('%.*f'%(nd,x)).rstrip('0').rstrip('.') if nd else str(int(x))

def mk(sc,tid,kind,anomaly,action,law,variants):
    assert len(variants)==5,(tid,len(variants))
    v0=variants[0]; t={"id":tid,"kind":kind,"anomaly":anomaly,"action":action,"law":law}
    for k in ('prompt','input','answer','tolerance','outcome','explanation','expectedKeywords','keywordSynonyms','coachSecrets'):
        if k in v0: t[k]=v0[k]
    t['params']=v0.get('params',{}); t['variants']=variants; sc['trials'].append(t)

def trs(p,opts,a,out,ex): return {"prompt":p,"input":ch(*opts),"answer":{"choice":a},"outcome":out,"explanation":ex}

# ======================= Tab 1: States & Changes =======================
S1={"id":"states_changes","tabName":"States & Changes","title":"The Hot Plate","setup":"A beaker on a hot plate that stands on a weighing scale, with a digital thermometer. Heat it, or cool it, and watch the state of the water change.","trials":[]}
KW1=["mass","conserved","state","matter"]
SY1={"mass":["amount","weight","how much"],"conserved":["conservation","stays the same","same","unchanged","constant","not lost","not created","nothing lost"],"state":["solid","liquid","gas","phase","physical change"],"matter":["substance","particles","atoms","molecules","water"]}
massOpts=ch(("down","It decreases"),("up","It increases"),("same","It stays exactly the same"))
def s1_choice(prompt,ans,out,expl,params,kw=KW1,syn=SY1):
    return {"prompt":prompt,"input":massOpts,"answer":{"choice":ans},"outcome":out,"explanation":expl,"expectedKeywords":kw,"keywordSynonyms":syn,"coachSecrets":[],"params":params}
def s1_num(prompt,val,out,expl,params):
    return {"prompt":prompt,"input":num(("mass","Mass on the scale","g")),"answer":{"mass":val},"tolerance":2,"outcome":out,"explanation":expl,"expectedKeywords":KW1,"keywordSynonyms":SY1,"coachSecrets":[],"params":params}
conserve="Matter is neither created nor destroyed when a substance changes state. The same particles are there, only arranged differently, so the mass does not change."
v=[
 s1_choice("A beaker (100 g) holds 150 g of ice. You heat it until all the ice has melted into water, nothing escaping. What happens to the mass the scale shows?","same","The scale reads 250 g before and 250 g after: exactly the same.",conserve,{"mode":"melt","sub":150,"beaker":100,"lid":False}),
 s1_num("A beaker (80 g) holds 220 g of ice. You heat it until every bit has melted. What does the scale read afterwards?",300,"300 g, exactly what it read at the start.",conserve+" Here 80 g + 220 g = 300 g before and after.",{"mode":"melt","sub":220,"beaker":80,"lid":False}),
 s1_num("A sealed bottle (60 g) holds 300 g of water. You put it in a freezer until the water is frozen solid. What does the scale read afterwards?",360,"360 g, the same as when the water was liquid.",conserve+" Freezing only changes the state: 60 g + 300 g = 360 g before and after.",{"mode":"freeze","sub":300,"beaker":60,"lid":True}),
 s1_choice("A strong sealed flask (90 g) holds 120 g of water. You heat it until all the water has boiled into steam, which cannot escape. What happens to the mass the scale shows?","same","The scale reads 210 g before and 210 g after: exactly the same.",conserve+" The steam is still inside the flask, so all 120 g of it is still on the scale.",{"mode":"boil_sealed","sub":120,"beaker":90,"lid":True}),
 s1_choice("An open beaker (100 g) holds 200 g of water. You boil it for a while until about a third of the water has gone. What happens to the mass the scale shows?","down","The scale falls from 300 g to about 233 g: the steam that left took its mass with it.","The mass did not vanish: it is carried away by the steam into the air. If the steam were trapped, the scale would show exactly the same. Matter is conserved; it just left the beaker.",{"mode":"boil_open","sub":200,"beaker":100,"lid":False},kw=["steam","escaped","gas","mass"],syn={"steam":["vapour","vapor","water vapour","gas"],"escaped":["escapes","left","leaves","lost","went","carried","floats away","goes into the air"],"gas":["air","vapour","vapor"],"mass":["weight","amount","matter"]}),
]
mk(S1,'state_1','prediction',True,'heat',{"name":"Conservation of mass"},v)

def s2(prompt,opts,ans,out,expl,params):
    return {"prompt":prompt,"input":ch(*opts),"answer":{"choice":ans},"outcome":out,"explanation":expl,"coachSecrets":[],"params":params}
def s2n(prompt,field,val,unit,out,expl,params,tol=1):
    return {"prompt":prompt,"input":num((field[0],field[1],unit)),"answer":{field[0]:val},"tolerance":tol,"outcome":out,"explanation":expl,"coachSecrets":[],"params":params}
v=[
 s2("A beaker holds a mixture of ice and water, heated gently. While the ice is melting, what does the thermometer do?",[("rise","It keeps rising steadily"),("zero","It stays at 0 °C until all the ice has melted"),("fall","It falls")],"zero","It holds at 0 °C the whole time the ice is melting, then rises once the ice has gone.","All the heat goes into breaking the bonds that hold the ice together, not into making the particles move faster. The temperature stays at the melting point until the change of state is complete.",{"mode":"curve","sub":100,"beaker":100,"lid":False,"show":"melt"}),
 s2("Water in an open beaker is boiling vigorously at 100 °C. You turn the hot plate up to its highest setting. What does the thermometer read now?",[("same","It stays at 100 °C"),("more","It rises well above 100 °C"),("less","It falls below 100 °C")],"same","It stays at 100 °C: the water just boils away faster.","While water is boiling, all the extra heat goes into turning liquid into gas, not into raising the temperature. The boiling point is fixed, whatever the heat.",{"mode":"curve","sub":150,"beaker":100,"lid":False,"show":"boil"}),
 s2n("You heat a beaker of pure ice. At what temperature does the ice start to melt?",("temp","Melting point"),0,"°C","0 °C.","Pure ice melts at 0 °C at normal pressure, and the temperature stays there until the ice has all melted.",{"mode":"curve","sub":120,"beaker":100,"lid":False,"show":"melt"}),
 s2("About how much bigger is the volume when a litre of liquid water boils into steam?",[("same","About the same"),("two","About twice as big"),("huge","More than a thousand times bigger")],"huge","About 1,700 times bigger.","In a gas the particles are far apart and fly freely, so a given amount of matter fills far more space than the same amount as a liquid. The mass has not changed, but the volume is enormous.",{"mode":"curve","sub":100,"beaker":100,"lid":True,"show":"volume"}),
 s2n("Water boils in a beaker at normal air pressure. At what temperature does it boil?",("temp","Boiling point"),100,"°C","100 °C.","At normal pressure pure water boils at 100 °C, and the thermometer stays there for as long as it boils.",{"mode":"curve","sub":140,"beaker":100,"lid":False,"show":"boil"}),
]
mk(S1,'state_2','prediction',False,'heat',{"name":"Heating curve"},v)

def s3(prompt,opts,ans,out,expl,state):
    return {"prompt":prompt,"input":ch(*opts),"answer":{"choice":ans},"outcome":out,"explanation":expl,"coachSecrets":[],"params":{"focus":state}}
sOpts=[("solid","Solid"),("liquid","Liquid"),("gas","Gas")]
v=[
 s3("Which state of matter can be squashed into a much smaller volume most easily?",sOpts,"gas","Gas.","The particles of a gas are far apart with lots of empty space between them, so they can be pushed much closer together.","gas"),
 s3("Which state of matter has a fixed shape and a fixed volume?",sOpts,"solid","Solid.","The particles of a solid are held in fixed positions, vibrating on the spot, so it keeps its shape and its volume.","solid"),
 s3("In which state of matter are the particles furthest apart?",sOpts,"gas","Gas.","Gas particles move freely and spread out to fill their container, so they are far apart.","gas"),
 s3("Which state of matter takes the shape of its container but keeps a fixed volume?",sOpts,"liquid","Liquid.","Liquid particles are close together but can slide past each other, so a liquid flows and fills the bottom of its container while keeping the same volume.","liquid"),
 s3("In which state of matter can the particles not move from place to place, only vibrate?",sOpts,"solid","Solid.","In a solid each particle is held in place by its neighbours and can only vibrate around that position.","solid"),
]
mk(S1,'state_3','prediction',False,'particles',{"name":"States of matter"},v)

v=[
 trs("On a hot day a puddle of water disappears. Where has the water gone?",[("air","It has evaporated into the air as water vapour"),("gone","It has been destroyed"),("ground","It has turned into soil")],"air","It evaporated into the air as water vapour.","Liquid water has changed state to a gas. No matter was destroyed: the water is now in the air as vapour."),
 trs("Drops of water form on the outside of a cold glass of water on a warm day. Where does the water come from?",[("air","From water vapour in the air, which cooled and condensed"),("glass","It leaks through the glass"),("none","It is made from the cold")],"air","From water vapour in the air.","Water vapour in the warm air cools against the cold glass and changes from gas to liquid. This is condensation."),
 trs("A sealed bag holds a lump of dry ice (solid carbon dioxide). The dry ice turns into gas and the bag swells. What happens to the mass of the sealed bag?",[("same","It stays the same"),("down","It decreases"),("up","It increases")],"same","It stays the same.","The solid became a gas inside the sealed bag. Nothing could escape, so the total mass is unchanged."),
 trs("A candle in an open dish is melted and then left to set again. Which statement is true?",[("physical","Only the state of the wax changed, and it can be reversed"),("chemical","The wax became a new substance"),("lost","Some of the wax was destroyed")],"physical","Only the state of the wax changed, and it can be reversed.","Melting and freezing are changes of state. The wax is the same substance in both."),
 trs("Which of these changes is a change of state?",[("freeze","Water freezing into ice"),("rust","Iron rusting"),("burn","Paper burning")],"freeze","Water freezing into ice.","Freezing changes only the state of the water. Rusting and burning make new substances.")]
mk(S1,'tr_state','transfer',False,None,{"name":"States of matter"},v)

# ======================= Tab 2: Physical vs chemical =======================
S2={"id":"properties_changes","tabName":"Physical vs. Chemical","title":"The Test Bench","setup":"A bench with samples to test and four tools: a hammer, a magnet, a small circuit with a bulb, and a Bunsen burner. There is also a beaker of water for dissolving things.","trials":[]}
chOpts=[("physical","A physical change"),("chemical","A chemical change")]
def p1(prompt,ans,out,expl,params):
    return {"prompt":prompt,"input":ch(*chOpts),"answer":{"choice":ans},"outcome":out,"explanation":expl,"coachSecrets":[],"params":params}
chem="A chemical change makes a new substance with new properties, and it is hard or impossible to reverse. A physical change alters only the form or the state, and the substance stays the same."
v=[
 p1("Substance A is a strip of silvery magnesium ribbon. You hold it in the burner flame and it ignites. Is this a physical or a chemical change?","chemical","It burns with a dazzling white light and leaves a white powder, magnesium oxide: a brand new substance.",chem+" The silvery metal has combined with oxygen to make a white powder that is nothing like magnesium.",{"substance":"magnesium","process":"burn"}),
 p1("Substance B is a block of wax. You warm it gently over the burner until it becomes a clear liquid puddle. Is this a physical or a chemical change?","physical","The wax melts into a puddle, and sets back into the same wax when it cools.",chem+" Melting is a change of state: the wax is the same substance as a liquid.",{"substance":"wax","process":"melt"}),
 p1("Substance C is white sugar. You heat it strongly in the flame and it turns brown, then black, giving off steam and smoke. Is this a physical or a chemical change?","chemical","It turns into black carbon and gives off water vapour: new substances that cannot turn back into sugar.",chem+" Heating has broken the sugar down into carbon and water; you cannot get the sugar back.",{"substance":"sugar","process":"burn"}),
 p1("Substance D is a shiny orange copper strip. You hold it in the flame and its surface turns black. Is this a physical or a chemical change?","chemical","The surface turns into black copper oxide, a new substance.",chem+" The copper has reacted with oxygen from the air, making black copper oxide.",{"substance":"copper","process":"burn"}),
 p1("Substance E is a few purple-black iodine crystals in a closed tube. You warm the tube gently: purple gas fills it, and on cooling the crystals form again. Is this a physical or a chemical change?","physical","The crystals turn to purple vapour and then back into the same crystals.",chem+" Turning from solid to gas and back is only a change of state: the iodine is the same substance throughout.",{"substance":"iodine","process":"sublime"}),
]
mk(S2,'prop_1','prediction',False,'burn',{"name":"Physical and chemical change"},v)

recOpts=[("yes","Yes: the original substance comes back"),("no","No: it has been changed into something different")]
KW2=["dissolve","physical","particles","evaporate"]
SY2={"dissolve":["dissolves","dissolved","dissolving","disappear","disappears"],"physical":["not chemical","no new substance","same substance","reversible","can be reversed","change of state"],"particles":["molecules","ions","atoms","bits","pieces","still there","still present"],"evaporate":["evaporates","evaporated","evaporating","boil off","water leaves","dries","dry"]}
def p2(prompt,ans,out,expl,params,kw=KW2,syn=SY2):
    return {"prompt":prompt,"input":ch(*recOpts),"answer":{"choice":ans},"outcome":out,"explanation":expl,"expectedKeywords":kw,"keywordSynonyms":syn,"coachSecrets":[],"params":params}
dis="Dissolving is a physical change: the particles of the solid spread out among the water particles, but they are still there and unchanged. When the water evaporates they come together again as the original solid."
v=[
 p2("Substance F is white salt. You stir it into a beaker of water until it disappears completely. Then you boil the water away. Will you get the original salt back?","yes","White salt crystals are left in the beaker, just as before.",dis,{"substance":"salt","recover":True}),
 p2("Substance G is white sugar. It vanishes when stirred into warm water. You then gently evaporate all the water. Will you get the original sugar back?","yes","White sugar crystals are left in the dish.",dis+" (Gentle heating keeps the sugar from burning.)",{"substance":"sugar","recover":True}),
 p2("Substance H is blue copper sulfate crystals. They dissolve to give a blue solution. You evaporate the water. Will you get the original copper sulfate back?","yes","Blue copper sulfate crystals form again as the water leaves.",dis,{"substance":"copper_sulfate","recover":True}),
 p2("A fizzing tablet is dropped into water and fizzes until it has gone, giving off bubbles of gas. You then evaporate the water. Will you get the original tablet back?","no","Only a little white residue remains: not the tablet.","Here a chemical reaction happened: the tablet's ingredients reacted to make new substances, including carbon dioxide gas that escaped. Evaporating the water cannot bring the original tablet back, so this is a chemical change, unlike simple dissolving.",{"substance":"tablet","recover":False},kw=["chemical","reaction","new","gas"],syn={"chemical":["chemical change","chemically"],"reaction":["react","reacted","reacts"],"new":["different","new substance","new substances"],"gas":["bubbles","carbon dioxide","fizz","fizzing"]}),
 p2("A strip of magnesium ribbon is dropped into dilute acid. It fizzes and vanishes. You then evaporate the liquid. Will you get the original magnesium back?","no","A white salt is left, not shiny magnesium.","The magnesium reacted with the acid to make a new salt and hydrogen gas. That is a chemical change: the magnesium is gone for good. Dissolving a salt in water would have been reversible, but this was a reaction.",{"substance":"magnesium_acid","recover":False},kw=["chemical","reaction","new","gas"],syn={"chemical":["chemical change","chemically"],"reaction":["react","reacted","reacts"],"new":["different","new substance","salt"],"gas":["bubbles","hydrogen","fizz","fizzing"]}),
]
mk(S2,'prop_2','prediction',True,'dissolve',{"name":"Dissolving is physical"},v)

def p3(prompt,opts,ans,out,expl,params):
    return {"prompt":prompt,"input":ch(*opts),"answer":{"choice":ans},"outcome":out,"explanation":expl,"coachSecrets":[],"params":params}
v=[
 p3("You hit a strip of copper with the hammer. What happens to it?",[("flat","It flattens and bends without breaking"),("shatter","It shatters into pieces"),("none","Nothing at all: it is unchanged")],"flat","It flattens and bends: copper is malleable.","Metals are malleable: their layers of atoms can slide, so they can be hammered into shape. A brittle solid would shatter instead.",{"tool":"hammer","substance":"copper"}),
 p3("You hit a lump of yellow sulfur with the hammer. What happens to it?",[("flat","It flattens and bends without breaking"),("shatter","It shatters into pieces"),("none","Nothing at all: it is unchanged")],"shatter","It shatters into pieces: sulfur is brittle.","Non-metals such as sulfur are usually brittle: when hit, the layers cannot slide and the solid breaks apart.",{"tool":"hammer","substance":"sulfur"}),
 p3("You bring a magnet close to some iron filings, a copper strip and some salt. What happens?",[("iron","Only the iron is pulled towards the magnet"),("all","All three are pulled towards the magnet"),("none","None of them are")],"iron","Only the iron is attracted.","Iron is magnetic. Copper is a metal but it is not magnetic, and salt is not a metal at all.",{"tool":"magnet","substance":"iron"}),
 p3("A circuit has a battery and a bulb. You connect a graphite (pencil lead) rod into the gap. What happens to the bulb?",[("on","The bulb lights up"),("off","The bulb stays off"),("dim","The bulb glows then goes out")],"on","The bulb lights up.","Graphite is a non-metal, but its electrons are free to move along its layers, so it conducts electricity.",{"tool":"circuit","substance":"graphite"}),
 p3("You connect a dry crystal of salt into the gap in the circuit. What happens to the bulb?",[("on","The bulb lights up"),("off","The bulb stays off"),("dim","The bulb glows dimly")],"off","The bulb stays off.","A solid salt crystal does not conduct: its ions are locked in place. (Dissolved in water it would conduct.)",{"tool":"circuit","substance":"salt"}),
]
mk(S2,'prop_3','prediction',False,'test_tool',{"name":"Physical properties"},v)

v=[
 trs("A cook cracks an egg into a hot pan and it turns white and solid. Which kind of change is this?",[("chemical","A chemical change: the egg proteins have changed"),("physical","A physical change: the egg only changed state")],"chemical","A chemical change.","Cooking an egg changes its proteins permanently into new substances; it cannot be uncooked."),
 trs("You mix iron filings and sand and then pull out the iron with a magnet. Which statement is true?",[("physical","The iron and the sand were never changed into anything new"),("chemical","The iron and sand reacted to make a new substance"),("destroyed","Some of the iron was used up")],"physical","The iron and the sand were never changed.","A mixture can be separated by physical means because each substance keeps its own properties."),
 trs("A nail left outside turns brown and flaky. Which kind of change is this?",[("chemical","A chemical change: iron has reacted to make rust"),("physical","A physical change: the iron only changed colour")],"chemical","A chemical change.","Iron reacts with oxygen and water to make rust, a different substance that is flaky and not magnetic like iron."),
 trs("You crush a can flat. Which kind of change is this?",[("physical","A physical change: only the shape changed"),("chemical","A chemical change: a new substance was made")],"physical","A physical change.","The metal is still the same substance; only its shape changed."),
 trs("Which of these is a sign that a chemical change has happened?",[("gas","Bubbles of a new gas, a permanent colour change, or heat given out"),("size","Something got smaller"),("move","Something moved")],"gas","Bubbles of a new gas, a permanent colour change, or heat given out.","These are clues that a new substance has formed. A change in size or position is not.")]
mk(S2,'tr_prop','transfer',False,None,{"name":"Physical and chemical change"},v)

# ======================= Tab 3: Density & measurement =======================
S3={"id":"density_measurement","tabName":"Density & Measurement","title":"The Density Bench","setup":"A weighing scale, a measuring cylinder and a row of liquids in different colours. Measure mass and volume, see how the liquids behave together, then use an overflow can, a spring scale and a lump of clay to find out why things float (Archimedes' principle).","trials":[]}
LIQ={'honey':("Honey",1.42,0xd89b1f),'syrup':("Corn syrup",1.33,0xb35a1f),'soap':("Dish soap",1.06,0x62d0a8),'water':("Water",1.00,0x3b82f6),'oil':("Vegetable oil",0.92,0xf2d23c),'alcohol':("Rubbing alcohol",0.79,0xf48fb1),'milk':("Milk",1.03,0xf4f1e8),'glycerine':("Glycerine",1.26,0xcfe8ef)}
def lab(k): return LIQ[k][0]
def dens(k): return LIQ[k][1]
def d1(keys,most,ids):
    pick=max(keys,key=dens) if most else min(keys,key=dens)
    word='highest' if most else 'lowest'
    ds=', '.join(f"{lab(k).lower()} {f(dens(k),2)}" for k in sorted(keys,key=dens,reverse=True))
    return {"prompt":f"You weigh the same volume (50 mL) of {', '.join(lab(k).lower() for k in keys[:-1])} and {lab(keys[-1]).lower()} on the scale. Which liquid has the {word} density?","input":ch(*[(k,lab(k)) for k in keys]),"answer":{"choice":pick},"outcome":f"{lab(pick)}. Densities (g/mL): {ds}.","explanation":"Density is mass divided by volume. For the same volume, the liquid with the bigger mass is the denser one: it packs more matter into the same space.","coachSecrets":[],"params":{"liquids":keys,"volume":50}}
v=[d1(['honey','water','oil'],True,0),d1(['water','alcohol','syrup'],True,0),d1(['milk','oil','glycerine'],True,0),d1(['honey','water','oil'],False,0),d1(['alcohol','water','milk'],False,0)]
mk(S3,'den_1','prediction',False,'weigh_liquids',{"name":"Density","formula":"ρ = m / V"},v)

def d2_density(k,V):
    m=dens(k)*V
    return {"prompt":f"A {V} mL sample of {lab(k).lower()} is poured into the measuring cylinder and weighed: the scale reads {f(m,1)} g. Calculate its density.","input":num(("density","Density","g/mL")),"answer":{"density":round(dens(k),2)},"tolerance":0.06,"outcome":f"{f(dens(k),2)} g/mL.","explanation":f"Density = mass ÷ volume = {f(m,1)} g ÷ {V} mL = {f(dens(k),2)} g/mL.","coachSecrets":[],"params":{"liquids":[k],"volume":V,"mode":"density"}}
def d2_mass(k,V):
    m=dens(k)*V
    return {"prompt":f"The density of {lab(k).lower()} is {f(dens(k),2)} g/mL. You pour {V} mL into the measuring cylinder. What will the scale read?","input":num(("mass","Mass","g")),"answer":{"mass":round(m,1)},"tolerance":round(max(1,0.03*m),1),"outcome":f"{f(m,1)} g.","explanation":f"Mass = density × volume = {f(dens(k),2)} g/mL × {V} mL = {f(m,1)} g.","coachSecrets":[],"params":{"liquids":[k],"volume":V,"mode":"mass"}}
def d2_volume(k,V):
    m=dens(k)*V
    return {"prompt":f"You weigh out {f(m,1)} g of {lab(k).lower()}, whose density is {f(dens(k),2)} g/mL. What volume will it fill in the measuring cylinder?","input":num(("volume","Volume","mL")),"answer":{"volume":V},"tolerance":2,"outcome":f"{V} mL.","explanation":f"Volume = mass ÷ density = {f(m,1)} g ÷ {f(dens(k),2)} g/mL = {V} mL.","coachSecrets":[],"params":{"liquids":[k],"volume":V,"mode":"volume"}}
v=[d2_density('honey',50),d2_mass('honey',80),d2_density('oil',40),d2_volume('alcohol',50),d2_mass('water',65)]
mk(S3,'den_2','prediction',False,'measure',{"name":"Density","formula":"ρ = m / V"},v)

def perms(order):
    return [list(p) for p in itertools.permutations(order)]
def d3(keys):
    bottom_to_top=sorted(keys,key=dens,reverse=True)
    right=' > '.join(bottom_to_top)
    def label(o): return ' → '.join(lab(k) for k in o)+' (bottom to top)'
    correct=bottom_to_top
    wrong=[]
    rev=list(reversed(bottom_to_top)); wrong.append(rev)
    sw=bottom_to_top[:]; sw[0],sw[1]=sw[1],sw[0]; wrong.append(sw)
    sw2=bottom_to_top[:]; sw2[-1],sw2[-2]=sw2[-2],sw2[-1]; wrong.append(sw2)
    opts=[("right",label(correct))]+[(f"w{i}",label(w)) for i,w in enumerate(wrong[:3])]
    ds=', '.join(f"{lab(k)} {f(dens(k),2)}" for k in bottom_to_top)
    return {"prompt":f"You carefully pour {', '.join(lab(k).lower() for k in keys[:-1])} and {lab(keys[-1]).lower()} into one tall container. Predict the order they settle in.","input":ch(*opts),"answer":{"choice":"right"},"outcome":f"They settle in layers, densest at the bottom: {label(correct)[:-len(' (bottom to top)')]}. Densities (g/mL): {ds}.","explanation":"The densest liquid sinks to the bottom and the least dense floats on top: the layers are in order of density. This is the same thing the scale told you, now visible: more mass in the same volume means heavier per mL, so it sinks beneath the lighter liquids.","expectedKeywords":["density","dense","sinks","floats"],"keywordSynonyms":{"density":["denser","heavier per","mass per","mass and volume"],"dense":["denser","densest","heavier","heaviest"],"sinks":["sink","bottom","falls","goes down","below"],"floats":["float","top","rises","above","on top","lighter"]},"coachSecrets":[],"params":{"liquids":keys}}
v=[d3(['honey','water','oil']),d3(['syrup','soap','oil']),d3(['honey','soap','alcohol']),d3(['syrup','water','alcohol']),d3(['honey','syrup','water','oil'])]
mk(S3,'den_3','prediction',True,'layer',{"name":"Density and layers"},v)
# the pick order of options is shuffled per session by the lesson service; keep the first option the right one.

OBJ={'cork':("a cork",0.24),'ice':("an ice cube",0.92),'steel':("a steel bolt",7.8),'wax':("a lump of candle wax",0.90),'grape':("a grape",1.08),'plastic':("a plastic ball",0.60)}
def d4(obj,liq):
    od=OBJ[obj][1]; ld=dens(liq); floats=od<ld
    out=("It floats." if floats else "It sinks.")+f" The {OBJ[obj][0][2:] if OBJ[obj][0].startswith('a ') else OBJ[obj][0]} has a density of {f(od,2)} g/mL; {lab(liq).lower()} has {f(ld,2)} g/mL."
    return {"prompt":f"You drop {OBJ[obj][0]} (density {f(od,2)} g/mL) into a tall jar of {lab(liq).lower()} (density {f(ld,2)} g/mL). What happens?","input":ch(("float","It floats"),("sink","It sinks"),("hover","It hovers in the middle")),"answer":{"choice":"float" if floats else "sink"},"outcome":out,"explanation":"An object floats if it is less dense than the liquid, and sinks if it is denser. It is not about size or weight alone, but about mass per volume compared with the liquid's.","coachSecrets":[],"params":{"object":obj,"liquid":liq}}
v=[d4('cork','water'),d4('ice','water'),d4('ice','alcohol'),d4('steel','water'),d4('wax','oil')]
mk(S3,'den_4','prediction',False,'drop',{"name":"Density and floating"},v)

v=[
 trs("A tonne of feathers and a tonne of lead: which has the greater density?",[("lead","The lead"),("feathers","The feathers"),("same","They have the same density")],"lead","The lead.","Density is mass per volume. A tonne of lead takes up very little space, while a tonne of feathers fills a huge volume, so lead packs far more mass into each cm³."),
 trs("A ship made of steel, which is much denser than water, floats. Why?",[("hollow","Its hollow shape means its overall density, steel and air together, is less than water's"),("steel","Steel is less dense than water"),("big","Big objects always float")],"hollow","Its hollow shape lowers its average density.","What matters is the average density of the whole object. A hollow hull full of air is overall less dense than water, so it floats."),
 trs("Oil floats on top of vinegar when you pour them together. What does this tell you?",[("less","Oil is less dense than vinegar"),("more","Oil is more dense than vinegar"),("same","They have the same density")],"less","Oil is less dense than vinegar.","The less dense liquid always ends up on top."),
 trs("You squash a lump of modelling clay flat. What happens to its density?",[("same","It stays the same: mass and volume have not changed"),("up","It increases"),("down","It decreases")],"same","It stays the same.","Squashing changes the shape only. The mass and the volume are unchanged, so the density is too."),
 trs("A 10 cm³ block has a mass of 27 g. What is its density?",[("2.7","2.7 g/cm³"),("270","270 g/cm³"),("0.37","0.37 g/cm³")],"2.7","2.7 g/cm³.","Density = mass ÷ volume = 27 g ÷ 10 cm³ = 2.7 g/cm³.")]
mk(S3,'tr_den','transfer',False,None,{"name":"Density"},v)


# ---- Archimedes' principle: appended after the density questions, nothing above is changed ----
G=9.8
MAT={'iron':("iron",7.87),'aluminium':("aluminium",2.70),'lead':("lead",11.34),'steel':("steel",7.85),'copper':("copper",8.96),'wood':("wood",0.60),'cork':("cork",0.24),'wax':("wax",0.90),'brass':("brass",8.50),'clay':("clay",1.80)}
def mname(k): return MAT[k][0]
def mrho(k): return MAT[k][1]
def vol(side): return side**3                       # cm³ of a cube
def displaced(k,side,liq):                         # mL of liquid pushed out by a cube released in `liq`
    v=vol(side); m=mrho(k)*v
    return v if mrho(k)>=dens(liq) else m/dens(liq)

ARCH={"name":"Archimedes' principle","formula":"F = ρ g V"}
def a1(ka,sa,kb,sb,liq='water'):
    da=displaced(ka,sa,liq); db=displaced(kb,sb,liq)
    A=f"a {sa} cm {mname(ka)} cube"; B=f"a {sb} cm {mname(kb)} cube"
    ma=mrho(ka)*vol(sa); mb=mrho(kb)*vol(sb)
    if abs(da-db)<0.5: right="same"
    else: right="a" if da>db else "b"
    fa="floats" if mrho(ka)<dens(liq) else "sinks"; fb="floats" if mrho(kb)<dens(liq) else "sinks"
    out=f"A displaces {f(da,0)} mL and B displaces {f(db,0)} mL ({'the same' if right=='same' else 'more for '+('A' if right=='a' else 'B')}). A {fa} (mass {f(ma,0)} g) and B {fb} (mass {f(mb,0)} g)."
    ex="An object pushes aside water equal to the volume of it that is under the surface. A sinking object is fully under, so it displaces its own volume. A floating object sinks until the water it displaces weighs as much as it does. So how much overflows depends on the volume under water, not on how heavy the object looks."
    kw=["displace","volume","submerged","weight"]
    syn={"displace":["displaces","displaced","displacement","pushes aside","pushes out","overflow","overflows","spills"],"volume":["size","space","how big","bigger","larger"],"submerged":["under","underwater","under the water","below the surface","sinks","in the water"],"weight":["mass","heavy","heavier","float","floats","floating"]}
    return {"prompt":f"An overflow can is filled to the brim with {lab(liq).lower()}. You lower {A} (A) into it and catch what overflows, then do the same with {B} (B). Which one makes more liquid overflow?","input":ch(("a",f"A: the {sa} cm {mname(ka)} cube"),("b",f"B: the {sb} cm {mname(kb)} cube"),("same","They push out the same amount")),"answer":{"choice":right},"outcome":out,"explanation":ex,"expectedKeywords":kw,"keywordSynonyms":syn,"coachSecrets":[],"params":{"a":{"name":mname(ka),"side":sa,"density":mrho(ka)},"b":{"name":mname(kb),"side":sb,"density":mrho(kb)},"liquid":liq}}
v=[a1('iron',4,'wood',8),a1('lead',5,'aluminium',5),a1('iron',3,'aluminium',6),a1('steel',2,'cork',6),a1('wood',5,'wax',5)]
mk(S3,'arch_1','prediction',True,'displace',ARCH,v)

def weight_n(k,V): return mrho(k)*V/1000*G
def buoy_n(liq,V): return dens(liq)*V/1000*G
def a2_choice(k,V,liq):
    W=weight_n(k,V); B=buoy_n(liq,V)
    return {"prompt":f"A {V} cm³ {mname(k)} block hangs from a spring scale in the air, which reads {f(W,2)} N. You slowly lower it into a beaker of {lab(liq).lower()} until it is fully under. What happens to the reading?","input":ch(("down","It decreases"),("up","It increases"),("same","It stays the same")),"answer":{"choice":"down"},"outcome":f"It falls from {f(W,2)} N to {f(W-B,2)} N: the liquid pushes the block up with {f(B,2)} N.","explanation":"A liquid pushes up on anything in it. This upward buoyant force acts against the weight, so the block seems lighter: the scale reads the weight minus the buoyant force.","coachSecrets":[],"params":{"object":k,"volume":V,"liquid":liq,"density":mrho(k)}}
def a2_num(k,V,liq):
    W=weight_n(k,V); B=buoy_n(liq,V)
    return {"prompt":f"A {V} cm³ {mname(k)} block (density {f(mrho(k),2)} g/cm³) hangs from a spring scale in the air, reading {f(W,2)} N. You lower it fully into {lab(liq).lower()} (density {f(dens(liq),2)} g/cm³). What does the scale read now? (g = 9.8 N/kg)","input":num(("reading","Scale reading","N")),"answer":{"reading":round(W-B,2)},"tolerance":0.2,"outcome":f"{f(W-B,2)} N. The buoyant force is {f(B,2)} N, so {f(W,2)} − {f(B,2)} = {f(W-B,2)} N.","explanation":f"Buoyant force = weight of the liquid displaced = ρ g V = {f(dens(liq),2)} × 9.8 × {V} ÷ 1000 = {f(B,2)} N. The scale reads the weight in air minus this: {f(W,2)} − {f(B,2)} = {f(W-B,2)} N.","coachSecrets":[],"params":{"object":k,"volume":V,"liquid":liq,"density":mrho(k)}}
v=[a2_choice('iron',200,'water'),a2_num('iron',200,'water'),a2_num('aluminium',150,'water'),a2_num('copper',120,'oil'),a2_num('iron',250,'alcohol')]
mk(S3,'arch_2','prediction',False,'spring_scale',ARCH,v)

def a3(prompt,opts,right,out,expl,params,kw=None,syn=None):
    d={"prompt":prompt,"input":ch(*opts),"answer":{"choice":right},"outcome":out,"explanation":expl,"coachSecrets":[],"params":params}
    d["expectedKeywords"]=kw or ["buoyant","volume","displaced","water"]
    d["keywordSynonyms"]=syn or {"buoyant":["buoyancy","upthrust","upward force","lose weight","lighter","loss in weight","apparent weight"],"volume":["size","same size","same volume","how big"],"displaced":["displaces","displace","pushes aside","pushed aside","displacement"],"water":["liquid","fluid"]}
    return d
V3=100
def blk(k,V,liq): return {"object":k,"volume":V,"liquid":liq,"density":mrho(k)}
v=[
 a3(f"An iron block and an aluminium block have exactly the same size, {V3} cm³. Both are hung from spring scales and lowered fully into water. Which one loses more weight?",[("iron","The heavier iron block loses more"),("alu","The lighter aluminium block loses more"),("same","They lose exactly the same amount")],"same",f"Both lose {f(buoy_n('water',V3),2)} N. The iron reads {f(weight_n('iron',V3)-buoy_n('water',V3),2)} N and the aluminium {f(weight_n('aluminium',V3)-buoy_n('water',V3),2)} N.","The buoyant force equals the weight of the water displaced. Both blocks are the same size, so they displace the same amount of water and feel the same upward push, however heavy they are.",{"pair":["iron","aluminium"],"volume":V3,"liquid":"water","mode":"pair"}),
 a3("A steel block and a copper block, each 150 cm³, are lowered fully into vegetable oil. Which one is pushed up harder by the oil?",[("steel","The steel block"),("copper","The copper block"),("same","They are pushed up equally")],"same",f"Both feel {f(buoy_n('oil',150),2)} N upwards.","They displace the same volume of oil (150 cm³), so the weight of oil displaced is the same for both, and so is the buoyant force.",{"pair":["steel","copper"],"volume":150,"liquid":"oil","mode":"pair"}),
 a3("The same 200 cm³ iron block is hung from a scale and lowered fully into water, then dried and lowered fully into vegetable oil. Where does the block lose more weight?",[("water","In the water"),("oil","In the oil"),("same","The same in both")],"water",f"In water it loses {f(buoy_n('water',200),2)} N; in oil {f(buoy_n('oil',200),2)} N.","The buoyant force is ρ g V. The volume displaced is the same, but water is denser than oil, so the water displaced weighs more and pushes up harder.",{"pair":["iron","iron"],"volume":200,"liquid":"water","mode":"liquids","liquid2":"oil"}),
 a3("Two iron blocks are lowered fully into water: one is 100 cm³ and the other is 200 cm³. How does the buoyant force on the bigger block compare?",[("double","It is twice as big"),("same","It is the same"),("half","It is half as big")],"double",f"The 200 cm³ block feels {f(buoy_n('water',200),2)} N, twice the {f(buoy_n('water',100),2)} N on the 100 cm³ one.","The buoyant force is proportional to the volume under the liquid, which sets how much liquid is displaced. Twice the volume, twice the force.",{"pair":["iron","iron"],"volume":100,"volume2":200,"liquid":"water","mode":"volumes"}),
 a3("A 120 cm³ cork and a 120 cm³ steel ball are each held fully under water by hand. Which feels the larger upward buoyant force?",[("cork","The cork"),("steel","The steel ball"),("same","They feel the same buoyant force")],"same",f"Both feel {f(buoy_n('water',120),2)} N upwards.","Held fully under, each displaces 120 cm³ of water. The buoyant force depends on the volume displaced, not the material. (The cork floats up when let go only because its own weight is smaller.)",{"pair":["cork","steel"],"volume":120,"liquid":"water","mode":"pair"}),
]
mk(S3,'arch_3','prediction',True,'spring_scale',ARCH,v)

def a4(liq,V):
    B=buoy_n(liq,V)
    return {"prompt":f"A solid ball of volume {V} cm³ is held fully under {lab(liq).lower()} (density {f(dens(liq),2)} g/cm³). What buoyant force does the liquid exert on it? (g = 9.8 N/kg)","input":num(("force","Buoyant force","N")),"answer":{"force":round(B,2)},"tolerance":round(max(0.1,0.04*B),2),"outcome":f"{f(B,2)} N.","explanation":f"Buoyant force = weight of liquid displaced = ρ g V = {f(dens(liq),2)} × 9.8 × {V} ÷ 1000 = {f(B,2)} N.","coachSecrets":[],"params":{"object":"steel","volume":V,"liquid":liq,"density":mrho('steel'),"mode":"held"}}
v=[a4('water',250),a4('oil',400),a4('alcohol',500),a4('water',1000),a4('syrup',150)]
mk(S3,'arch_4','prediction',False,'spring_scale',ARCH,v)

CLAYM=100
def a5(m,hull,liq,note):
    need=m/dens(liq)
    floats_=hull>=need
    cv=m/mrho('clay')
    outcome=(f"It floats, riding with {f(need/hull*100,0)}% of the boat under the surface." if floats_ else f"It sinks: it would have to displace {f(need,0)} mL to hold itself up, but the boat only has {hull} mL of hull.")
    return {"prompt":f"A lump of {m} g of clay (density 1.8 g/cm³) sinks in water. You mould the same clay into a boat whose hull encloses {hull} cm³, and set it on {lab(liq).lower()} (density {f(dens(liq),2)} g/cm³). What happens?","input":ch(("float","It floats"),("sink","It sinks"),("hover","It hovers in the middle")),"answer":{"choice":"float" if floats_ else "sink"},"outcome":outcome,"explanation":f"The clay has the same mass in either shape, but a boat shape takes up far more space. To float, the boat must displace liquid that weighs as much as it does: {m} g of {lab(liq).lower()}, which is {f(need,0)} cm³. Its overall density is {m} g ÷ {hull} cm³ = {f(m/hull,2)} g/cm³, which is {'less' if floats_ else 'more'} than the liquid's {f(dens(liq),2)}.","expectedKeywords":["density","volume","displaced","weight"],"keywordSynonyms":{"density":["denser","less dense","mass per","average density","overall density"],"volume":["space","bigger","larger","hollow","shape","spread out","hull"],"displaced":["displaces","displace","pushes aside","pushed aside","displacement"],"weight":["mass","heavy","heavier","lighter","float","floats"]},"coachSecrets":[],"params":{"mass":m,"hull":hull,"liquid":liq,"claydensity":mrho('clay'),"clayvolume":round(cv,1)}}
v=[a5(100,250,'water',''),a5(100,80,'water',''),a5(150,170,'oil',''),a5(120,125,'alcohol',''),a5(200,300,'water','')]
mk(S3,'arch_5','prediction',True,'boat',ARCH,v)

v=[
 trs("A steel ship weighs thousands of tonnes, yet it floats. Why?",[("hull","It displaces a huge volume of water, which weighs as much as the ship"),("light","Steel is lighter than water"),("air","Air in the hull makes it weigh nothing")],"hull","It displaces water that weighs as much as the ship.","Archimedes' principle: a floating object displaces its own weight of water. The ship's hollow hull displaces so much water that the buoyant force equals its weight."),
 trs("A submarine takes water into its ballast tanks. What happens to it?",[("sink","Its average density goes up, so it sinks"),("float","Its average density goes up, so it rises"),("same","Nothing changes")],"sink","It sinks.","Taking in water adds weight but not volume, so its average density rises above the sea water's. Pumping the water out lets it rise."),
 trs("An egg sinks in plain water but floats when lots of salt is stirred in. Why?",[("dense","Salt water is denser, so the egg is now less dense than the liquid"),("egg","The salt makes the egg lighter"),("air","The salt puts air inside the egg")],"dense","Salt water is denser than the egg.","The buoyant force is ρ g V. A denser liquid gives a bigger push for the same volume, enough to hold the egg up. This is also why it is easy to float in the Dead Sea."),
 trs("A large block of ice floats in water with about nine tenths of it below the surface. What does that tell you?",[("less","Ice is a little less dense than water, about 0.92 times as dense"),("more","Ice is denser than water"),("same","Ice and water have exactly the same density")],"less","Ice is about 0.92 times as dense as water.","A floating object sinks until it displaces its own weight of water. The fraction under water equals the ratio of the densities: 0.92 for ice in water."),
 trs("A hydrometer is a weighted glass tube that floats upright in a liquid. In which liquid does it float highest?",[("dense","In the densest liquid"),("light","In the least dense liquid"),("same","The same height in all liquids")],"dense","In the densest liquid.","A denser liquid supplies the same buoyant force from less displaced volume, so less of the tube needs to sink."),
]
mk(S3,'tr_arch','transfer',False,None,ARCH,vt:=v)

L={"lessonId":"matter-properties","type":"science_matter_properties","subject":"Chemistry","title":"Matter & Its Properties Lab","summary":"Heat ice into steam and watch the mass stay the same, test substances to tell physical from chemical change, and weigh and pour liquids to see how density decides who sinks, ending with Archimedes' principle: why things float, how much they displace and how much lighter they feel in a liquid. Predict first, then watch what really happens.","durationMinutes":35,
 "assets":{"cylinder":M+"graduated-cylinder.glb","thermometer":M+"thermometer.glb","scale":M+"weighing-scale.glb","burner":M+"bunsen-burner.glb","hammer":M+"claw-hammer.glb","magnet":M+"horseshoe-magnet.glb"},
 "config":{"enableScenarioSwitcher":True,"minExplanationWords":6,"minPredictionMs":0,"telemetryRules":{"requirePredictionBeforeAction":True,"logMeasurementValues":True,"logLatency":True}},
 "scenarios":[S1,S2,S3],
 "laws":[{"id":"conservation","name":"Conservation of mass","summary":"Matter is neither created nor destroyed in a change of state."},{"id":"density","name":"Density","formula":"ρ = m / V","summary":"Mass per unit volume decides sinking and floating."},{"id":"archimedes","name":"Archimedes' principle","formula":"F = ρ g V","summary":"The buoyant force equals the weight of the fluid displaced."}],
 "liquids":{k:{"name":v[0],"density":v[1],"color":v[2]} for k,v in LIQ.items()},
 "uiSchema":{"hasTabs":True,"hasPredictionModal":True,"hasTemperatureSlider":True,"hasDigitalScaleDisplay":True,"hasMeasuringCylinderReadout":True,"hasSpringScaleReadout":True,"hasOverflowCan":True}}
# a coach secret the student can already read protects nothing
for sc in L['scenarios']:
    vis0=(sc['setup']+L['summary']).lower()
    for t in sc['trials']:
        for vv in [t]+t['variants']:
            vis=(vis0+vv.get('prompt','')+json.dumps(vv.get('input',{}))).lower()
            if 'coachSecrets' in vv: vv['coachSecrets']=[x for x in vv['coachSecrets'] if len(x)>=3 and x.lower() not in vis]
json.dump(L,open(OUT,'w'),indent=2,ensure_ascii=False)
print('questions',sum(len(s['trials']) for s in L['scenarios']),'variants',sum(len(t['variants']) for s in L['scenarios'] for t in s['trials']))
