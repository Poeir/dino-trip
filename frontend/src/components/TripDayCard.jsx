import { StarGlyph, RouteIcon, PinIcon } from './Icons.jsx'
import ImageSlot from './ImageSlot.jsx'
import DayRouteMap from './DayRouteMap.jsx'
import { placeCategoryIcon } from '../data/categoryImages.js'
import { dayDirectionsUrls } from '../utils/mapsLink.js'

// One day of a trip plan: header with Google Maps links, the route map and the
// timeline of stops. Used by the tourist's trip page and the admin trip detail
// so both show a plan the same way. `day` comes from decorateTripDays
// (lib/tripPlanView.js). `itemExtras(item)` adds content under a stop (the
// admin's issue / liked badges); `onSelectPlace` makes stops clickable.
export default function TripDayCard({ day, googleIds = {}, onSelectPlace, itemExtras }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E7E3D2', borderRadius: 22, padding: 26, marginBottom: 20, boxShadow: '0 10px 26px rgba(46,125,50,0.07)', animation: 'dc-fade-up 0.4s ease both' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg,#66BB6A,#2E7D32)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1, flexShrink: 0, boxShadow: '0 8px 16px rgba(46,125,50,0.3)' }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>DAY</span>
          <span style={{ fontSize: 17, fontWeight: 800 }}>{day.dayNum}</span>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#1B5E20' }}>วันที่ {day.dayNum}</div>
          <div style={{ fontSize: 12.5, color: '#626863' }}>{day.date}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {dayDirectionsUrls(day.items, googleIds).map((url, i, all) => (
            <a key={url} href={url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: '#2E7D32', background: '#E8F5E9', border: '1px solid #C8E6C9', borderRadius: 14, padding: '6px 12px', whiteSpace: 'nowrap' }}>
              <PinIcon box={false} color="#2E7D32" />เปิดใน Google Maps{all.length > 1 ? ` (${i + 1}/${all.length})` : ''}
            </a>
          ))}
        </div>
      </div>

      <DayRouteMap items={day.items} onSelectPlace={onSelectPlace} />

      <div style={{ position: 'relative', paddingLeft: 22 }}>
        <div style={{ position: 'absolute', left: 21, top: 8, bottom: 30, width: 2, background: 'linear-gradient(180deg,#66BB6A,#C8E6C9)', transformOrigin: 'top', animation: 'dc-grow 0.6s ease both' }}></div>
        {day.items.map((item) => {
          // The day's departure point is not a place, so it opens nothing.
          const clickable = onSelectPlace && item.kind !== 'start'
          return (
          <div key={item.placeId + item.time} style={{ position: 'relative', marginBottom: 14, animation: 'dc-slide-in 0.45s ease both' }}>
            {item.distanceFromPrev != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#626863', marginLeft: 26, marginBottom: 8 }}>
                <RouteIcon size={12} color="#626863" box={false} />เดินทางต่อ {item.distanceFromPrev} กม.
              </div>
            )}
            <div
              onClick={clickable ? () => onSelectPlace(item.placeId) : undefined}
              style={{ display: 'flex', gap: 16, alignItems: 'center', border: '1px solid #EFEBDB', borderRadius: 16, padding: 12, transition: 'transform 0.2s ease, box-shadow 0.2s ease', cursor: clickable ? 'pointer' : 'default' }}
            >
              <div style={{ position: 'absolute', left: -6, top: '50%', marginTop: -7, width: 14, height: 14, borderRadius: '50%', background: '#fff', border: '3px solid #2E7D32' }}></div>
              <div style={{ width: 68, flexShrink: 0, textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: '#2E7D32', lineHeight: 1.3 }}>{item.timeRangeLabel}</div>
                {item.durationLabel && (
                  <div style={{ fontSize: 10, color: '#626863', marginTop: 3 }}>{item.durationLabel}</div>
                )}
              </div>
              <ImageSlot src={item.place.img} shape="rounded" radius={12} style={{ width: 84, height: 84, flexShrink: 0 }} placeholder="ภาพ" icon={placeCategoryIcon(item.place.category)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: '#2E7D32', background: '#E8F5E9', padding: '2px 9px', borderRadius: 10 }}>{item.place.category}</span>
                <div style={{ fontWeight: 700, fontSize: 15.5, color: '#1f2a24', margin: '5px 0 3px' }}>{item.place.name}</div>
                {/* Hotel / trip-end / free-time slots have no rating or address ("-"). */}
                {item.place.rating !== '-' && (
                  <div style={{ fontSize: 12.5, color: '#5f6a63', marginBottom: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><StarGlyph /> {item.place.rating} · {item.place.address}</div>
                )}
                {itemExtras && itemExtras(item)}
              </div>
            </div>
          </div>
          )
        })}
      </div>
    </div>
  )
}
