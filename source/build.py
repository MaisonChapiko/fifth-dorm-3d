from pathlib import Path
source=Path(__file__).resolve().parent
r=source/'r-suite'
p=source.parent/'r-suite'
p.mkdir(parents=True,exist_ok=True)
html=(r/'index.html').read_text()
css=(r/'styles.css').read_text()
data=(r/'data/r.json').read_text().strip().replace('<','\\u003c')
model=(r/'model.js').read_text().replace('export function ','function ')
render=(r/'render.js').read_text().replace('export function ','function ')
viewer='\n'.join((r/'viewer.js').read_text().splitlines()[2:])
start=viewer.index('  const requested=')
end=viewer.index('  const model=buildSuite',start)
viewer=viewer[:start]+"  const data=JSON.parse(document.getElementById('suite-data').textContent);\n"+viewer[end:]
viewer=viewer.replace("const datasets={r:'./data/r.json'};\n","")
html=html.replace('<link rel="stylesheet" href="styles.css">','<style>\n'+css+'</style>')
html=html.replace('<script type="module" src="viewer.js"></script>',
                  '<script type="application/json" id="suite-data">'+data+'</script>\n'+
                  '<script type="module">\n'+model+render+viewer+'\n</script>')
(p/'index.html').write_text(html)
