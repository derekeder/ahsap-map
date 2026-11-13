import sys
tpl, css, data, out = sys.argv[1:5]
t=open(tpl).read().replace('/*LEAFLET_CSS*/', open(css).read()).replace('/*DATA*/', open(data).read())
open(out,'w').write(t); print(len(t))
