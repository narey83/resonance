"""Explicit genre prompt disambiguation; words are descriptions, not labels learned from audio."""
ALIASES={
 'Hardcore':['hardcore electronic dance','hardstyle','gabber techno'],
 'Breaks':['breakbeat electronic dance','electronic breaks'],
 'Arcadecore':['arcade chiptune','8-bit electronic'],
 'Game':['video game soundtrack'],
 'EDM':['festival electronic dance','big room house','electro house dance'],
 'Retro':['retro synthwave','retro electronic'],
 'UK Garage':['UK garage dance','two-step garage'],
 'Piano':['solo piano'],
 'Chill':['chilled downtempo','ambient chillout'],
}
def prompts(label,profile):
 if profile=='canonical':return [f'This is a {label} music track.']
 if profile=='author-template':return [f'This audio is a {label} song.']
 if profile=='disambiguated':return [f'This is {name} music.' for name in ALIASES.get(label,[label])]
 raise ValueError('Unknown genre prompt profile')
