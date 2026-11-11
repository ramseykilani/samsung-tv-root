// Run with: node tests/test_media_episodes.js (Playwright + Chromium required).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox']});
  try {
    const page = await browser.newPage();
    const base = path.join(__dirname, '../framed');
    await page.setContent(fs.readFileSync(path.join(base, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<link\b[^>]*>/g, ''));
    await page.evaluate(() => {
      window.episodes = [{id:'s1e1', season:1, episode:1, title:'Pilot'}, {id:'s1e2', season:1, episode:2, title:'Second'}, {id:'s2e1', season:2, episode:1, title:'Return'}];
      window.current = {cat:{}, item:{id:'show', type:'series', name:'Show'}, episodeId:'s1e2'};
      window.watched = {};
      window.requests = [];
      window.source = {name:'Torrent addon', file:'Short preview', playable:true, raw:{name:'Full release', title:'Very long filename\nSize: 12 GB\nLanguages: English, French', description:'Complete additional description'}};
      window.framed = {
        router:{register(n, s) { (window.screens ||= {})[n] = s; }, go(n) {window.destination=n;}},
        nav:{setScope(){}, focus(el){el.focus();}, isBackKey(){return false;}},
        controls:{render(el, rows, change){window.changeSeason=change;}}, toast(){},
        media:{item(){return current;}, prefs(){return {};}, progressFor(){return null;}, isSaved(){return false;},
          isWatched(t,id){return !!watched[id];}, toggleWatched(c,it,id){return watched[id]=!watched[id];},
          meta(c,id,cb){cb({videos:episodes});}, addonCount(){return 1;},
          streams(t,id,cb){requests.push(id); cb([source]);},
          start(s,ctx){window.started={s,ctx};},
          open(cat,item,episodeId){window.current={cat,item,episodeId};},
          playing(){return {...source,url:'test.mp4'};},
          playingContext(){return {cat:current.cat,item:current.item,episodeId:'s1e2',episodes};},
          resumeFor(){return 0;}, recordProgress(){}, subtitles(t,id,cb){cb([]);}
        }
      };
    });
    await page.addScriptTag({path:path.join(base,'js/screens/media-item.js')});
    await page.evaluate(() => {screens['media-item'].el.hidden=false; screens['media-item'].enter();});
    assert.equal(await page.locator('#md-watched').isHidden(),true);
    assert.equal(await page.evaluate(() => requests.at(-1)),'s1e2');
    await page.locator('.ep-watch').nth(1).click();
    assert.deepEqual(await page.evaluate(() => watched),{s1e2:true});
    assert.equal(await page.locator('.ep[data-watched="true"] .ep__title').textContent(),'Second');
    assert.equal(await page.locator('.src').count(),1,'marking watched must retain sources');
    await page.locator('.ep-watch').nth(1).click();
    assert.equal(await page.evaluate(() => watched.s1e2),false);
    await page.getByText('Show full description',{exact:true}).click();
    assert.match(await page.locator('.src-description').textContent(),/Languages: English, French\nComplete additional description/);
    assert.equal(await page.evaluate(() => window.started),undefined,'expanding must not start playback');
    await page.getByText('Hide full description',{exact:true}).click();
    assert.equal(await page.locator('.src-description').isHidden(),true);
    await page.evaluate(() => changeSeason('season',2));
    await page.locator('.ep-watch').click();
    assert.equal(await page.evaluate(() => watched.s2e1),true);
    await page.locator('.ep').click();
    assert.equal(await page.evaluate(() => requests.at(-1)),'s2e1');
    await page.locator('.src').click();
    assert.equal(await page.evaluate(() => started.ctx.episodeId),'s2e1');
    assert.equal(await page.evaluate(() => started.ctx.streams.length),1);
    // The real player must hand off to the detail picker without selecting a source.
    await page.addScriptTag({path:path.join(base,'js/engine.js')});
    await page.addScriptTag({path:path.join(base,'js/screens/media-play.js')});
    await page.evaluate(() => {screens['media-play'].el.hidden=false; screens['media-play'].enter();});
    await page.locator('#mp-next').click();
    assert.equal(await page.evaluate(() => current.episodeId),'s2e1');
    assert.equal(await page.evaluate(() => destination),'media-item');
    await page.evaluate(() => {screens['media-play'].leave(); screens['media-item'].enter();});
    assert.equal(await page.locator('.ep[data-open="true"] .ep__title').textContent(),'Return');
    console.log('Episode controls: per-episode watched state, retained sources, expanded descriptions, season selection and next-episode picker passed.');
  } finally {await browser.close();}
})().catch(e => {console.error(e); process.exitCode=1;});
