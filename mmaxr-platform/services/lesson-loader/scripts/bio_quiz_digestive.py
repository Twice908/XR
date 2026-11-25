# Quiz pools for the digestive-system lab. Each entry: (question, correct, [3 wrong options], why).
# Questions follow what the tour animation and explanation show at each stop.
QUIZ = {
 'salivary_glands': [
  ("You smell freshly baked bread and your mouth waters. What are the salivary glands doing?", "Releasing saliva that holds amylase before any food arrives", ["Releasing bile to digest the bread's fat", "Releasing HCl to kill bacteria", "Storing saliva until you swallow"], "Even the smell of food starts the salivary glands, so saliva with amylase is ready for starch."),
  ("Which enzyme in saliva starts breaking starch down?", "Salivary amylase", ["Pepsin", "Lipase", "Trypsin"], "Salivary amylase (ptyalin) turns starch into the sugar maltose."),
  ("What does the lysozyme in saliva do?", "Kills bacteria that enter with food", ["Breaks down proteins", "Emulsifies fats", "Lubricates the bolus"], "Lysozyme is the germ-killing part of saliva. Mucus does the lubricating."),
  ("Where are the three pairs of salivary glands found?", "Near the ears, under the jaw and under the tongue", ["In the wall of the stomach", "Beside the liver", "Along the small intestine"], "Parotid (by the ears), submandibular (under the jaw) and sublingual (under the tongue)."),
  ("What is the job of mucus in saliva?", "Makes food slippery and soft so it forms a bolus that is easy to swallow", ["Breaks starch into maltose", "Neutralises stomach acid", "Absorbs glucose into blood"], "Mucus lubricates; it is not an enzyme."),
 ],
 'mouth': [
  ("Which teeth are best for tearing food?", "Canines", ["Incisors", "Molars", "Wisdom teeth only"], "Incisors cut, canines tear and molars grind."),
  ("Chewing food into small pieces mainly helps because it…", "Gives enzymes a larger surface to work on", ["Makes the food acidic", "Turns starch into protein", "Removes all the water from food"], "Mechanical digestion increases surface area for chemical digestion."),
  ("Hold a piece of bread in your mouth for a minute and it tastes sweeter. Why?", "Salivary amylase turns starch into the sugar maltose", ["Pepsin turns protein into sugar", "The tongue makes glucose", "Bile turns starch into fat"], "Chemical digestion of starch begins in the mouth."),
  ("What is the soft ball of chewed food that is swallowed called?", "Bolus", ["Chyme", "Bile", "Villus"], "Chyme is the thick liquid made later in the stomach."),
  ("Why does salivary amylase stop working once food reaches the stomach?", "Stomach acid stops it", ["It is used up as soon as you swallow", "Bile destroys it", "There is no starch left"], "Amylase works in a neutral to slightly alkaline mouth; the acid in the stomach stops it."),
 ],
 'esophagus': [
  ("What stops food from entering the windpipe when you swallow?", "The epiglottis folds over the windpipe", ["The tongue seals the nose", "Peristalsis closes the lungs", "The oesophagus closes"], "The epiglottis covers the entrance of the larynx."),
  ("What pushes the bolus down the oesophagus?", "Waves of muscle contraction called peristalsis", ["Gravity alone", "Enzymes pulling it down", "Suction from the stomach"], "Peristalsis works even if you are upside down."),
  ("Is any chemical digestion done in the oesophagus?", "No. Only mucus is added to lubricate", ["Yes, proteins are broken into peptones", "Yes, fats are emulsified", "Yes, starch is changed to glucose"], "No digestive enzymes are made here."),
  ("An astronaut can swallow in space. Which fact explains this?", "Peristalsis, not gravity, moves food along", ["Saliva is lighter in space", "The stomach pulls food up", "Food floats into the stomach"], "Muscle waves do the moving."),
  ("About how long does the bolus take to pass down the oesophagus?", "A few seconds", ["About an hour", "About a day", "About ten minutes"], "Peristalsis squeezes it down in a few seconds."),
 ],
 'stomach': [
  ("What does hydrochloric acid do in the stomach?", "Kills bacteria and activates pepsin", ["Digests fats into fatty acids", "Absorbs water into blood", "Turns starch into maltose"], "HCl makes the acidic medium pepsin needs."),
  ("Which nutrient does pepsin start digesting?", "Proteins", ["Carbohydrates", "Fats", "Vitamins"], "Pepsin breaks proteins into smaller peptones."),
  ("What protects the stomach wall from its own acid?", "A layer of mucus", ["Bile", "Saliva", "A layer of villi"], "Mucus lines the stomach and shields it."),
  ("What is the thick liquid that leaves the stomach called?", "Chyme", ["Bolus", "Bile", "Lymph"], "Churning turns food into chyme."),
  ("A medicine that greatly reduces stomach acid would mainly slow digestion of…", "Proteins, because pepsin needs acid to work", ["Starch in the mouth", "Fats in the liver", "Water in the large intestine"], "Without HCl pepsin stays inactive."),
 ],
 'liver': [
  ("What does bile contain?", "Bile salts but no digestive enzymes", ["Lipase and amylase", "Pepsin and HCl", "Trypsin and maltase"], "Bile helps digestion without being an enzyme."),
  ("Where is bile stored and concentrated?", "The gallbladder", ["The pancreas", "The stomach", "The villi"], "The liver makes bile and the gallbladder stores it."),
  ("What do bile salts do to fat globules?", "Break them into tiny droplets (emulsify) so lipase can reach them", ["Turn them into protein", "Turn them into glucose", "Absorb them straight into blood"], "Emulsification gives enzymes more surface."),
  ("Why is bile alkaline?", "To neutralise the acidic chyme from the stomach", ["To start protein digestion", "To kill the bacteria in saliva", "To make the bolus"], "Intestinal enzymes need a less acidic medium."),
  ("A person's bile duct is blocked. Which food group becomes hardest to digest?", "Fats", ["Starch", "Proteins", "Water"], "Without bile, fats are not emulsified."),
 ],
 'pancreas': [
  ("Which enzyme in pancreatic juice digests fats?", "Lipase", ["Amylase", "Trypsin", "Pepsin"], "Lipase splits fats into fatty acids and glycerol."),
  ("Why does pancreatic juice contain sodium bicarbonate?", "To neutralise the acidic chyme entering the duodenum", ["To digest starch", "To kill bacteria in the mouth", "To make bile"], "Bicarbonate is alkaline."),
  ("Trypsin digests…", "Proteins into peptides", ["Fats into fatty acids", "Starch into maltose", "Sucrose into glucose"], "Trypsin is the pancreatic protease."),
  ("How does pancreatic juice reach the small intestine?", "Through the pancreatic duct into the duodenum", ["Through the bloodstream", "Through the oesophagus", "Through the large intestine"], "A duct delivers it to the duodenum."),
  ("Which statement about the pancreas is true?", "It makes digestive enzymes and also the hormone insulin", ["It only stores bile", "It absorbs digested food", "It makes only acid"], "The pancreas has both digestive and hormonal roles."),
 ],
 'small_intestine': [
  ("Which enzyme turns maltose into glucose?", "Maltase", ["Lactase", "Pepsin", "Lipase"], "Maltase completes the digestion of maltose."),
  ("What do peptidases (erepsin) finish breaking down?", "Peptides into amino acids", ["Fats into glycerol", "Starch into maltose", "Lactose into galactose"], "Proteins end as amino acids."),
  ("Which enzyme digests the sugar in milk?", "Lactase", ["Sucrase", "Maltase", "Amylase"], "Lactase breaks lactose into glucose and galactose."),
  ("What is the role of enterokinase?", "Activates trypsin", ["Digests fat", "Neutralises acid", "Absorbs glucose"], "Trypsin is released inactive and switched on here."),
  ("By the end of the small intestine, starch has become…", "Glucose", ["Fatty acids", "Amino acids", "Bile salts"], "Carbohydrates end as simple sugars such as glucose."),
 ],
 'villi': [
  ("Why is the small intestine wall folded into villi?", "To increase the surface area for absorption", ["To slow food down so it can be stored", "To make more bile", "To grind food"], "More surface means faster absorption."),
  ("What does the lacteal in a villus absorb?", "Fatty acids and glycerol", ["Glucose", "Amino acids", "Water only"], "Fats go into the lymph through the lacteal."),
  ("Which nutrients pass into the capillaries of a villus?", "Glucose and amino acids", ["Fatty acids and glycerol", "Bile and mucus", "Faeces and water"], "Capillaries carry them to the blood."),
  ("Why can nutrients cross a villus so quickly?", "Its wall is only one cell thick and next to capillaries", ["It is covered in thick mucus", "It is full of enzymes only", "It is made of cartilage"], "A thin wall and a rich blood supply speed absorption."),
  ("After absorption in the villi, where does the blood first take the nutrients?", "To the liver, then on to every cell", ["Straight to the mouth", "Back to the stomach", "To the large intestine"], "Blood from the intestine goes to the liver first."),
 ],
 'large_intestine': [
  ("What does the large intestine mainly absorb?", "Water and salts from undigested food", ["Glucose from starch", "Amino acids from proteins", "Fatty acids from fats"], "It dries the waste into solid faeces."),
  ("Where is solid waste stored before it leaves the body?", "The rectum", ["The gallbladder", "The duodenum", "The pancreas"], "The anus then lets it out."),
  ("What is the removal of undigested waste called?", "Egestion", ["Ingestion", "Absorption", "Assimilation"], "Egestion is expelled through the anus."),
  ("Why does diarrhoea cause dehydration?", "The large intestine has little time to absorb water", ["Too much bile is made", "The stomach makes extra acid", "Villi stop absorbing glucose"], "Water not absorbed is lost."),
  ("Which part of the food reaches the large intestine?", "Mostly undigested food such as fibre", ["Fully digested glucose", "Freshly chewed bolus", "Bile and saliva only"], "Digested nutrients were absorbed earlier."),
 ],
}
