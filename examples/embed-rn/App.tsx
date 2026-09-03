import {
  type AutocompleteItem,
  type Lang,
  type MapHandle,
  MapsLibVNMap,
  Marker,
  type Theme,
  usePlaces,
} from '@mapslibvn/react-native';
import * as Application from 'expo-application';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const API_KEY = process.env.EXPO_PUBLIC_MAPSLIBVN_KEY ?? '';
const API_BASE = process.env.EXPO_PUBLIC_MAPSLIBVN_API ?? 'https://api.ai-solutions.io.vn';

/** Ô tìm kiếm + danh sách gợi ý — dùng usePlaces với client của map qua context. */
function Search({ onPick }: { onPick: (item: AutocompleteItem) => void }) {
  const [q, setQ] = useState('');
  const { items, loading } = usePlaces(q, { near: [10.776, 106.7], limit: 6 });
  return (
    <View style={styles.search}>
      <TextInput
        style={styles.input}
        placeholder="Tìm địa điểm, ví dụ highlands"
        value={q}
        onChangeText={setQ}
        autoCorrect={false}
        testID="search-input"
      />
      {q.trim().length >= 2 && (
        <FlatList
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          data={items}
          keyExtractor={(it, i) => it.id ?? `${it.type}-${i}`}
          ListEmptyComponent={
            <Text style={styles.hint}>{loading ? 'Đang tìm…' : 'Không có gợi ý'}</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => {
                setQ('');
                onPick(item);
              }}
            >
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.secondary}>{item.secondary}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>('light');
  const [lang, setLang] = useState<Lang>('vi');
  const [map, setMap] = useState<MapHandle | null>(null);
  const [picked, setPicked] = useState<AutocompleteItem | null>(null);

  if (!API_KEY) {
    return (
      <SafeAreaView style={styles.center}>
        <Text>Thiếu EXPO_PUBLIC_MAPSLIBVN_KEY — chạy `pnpm example:rn` từ gốc repo.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="auto" />
      <MapsLibVNMap
        apiKey={API_KEY}
        apiBase={API_BASE}
        style={theme}
        lang={lang}
        {...(Application.applicationId ? { bundleId: Application.applicationId } : {})}
        onLoad={setMap}
        onPoiClick={(poi) => Alert.alert(poi.name, `${poi.category} · ${poi.group}`)}
        onError={(e) => Alert.alert('Lỗi bản đồ', e.message)}
        testID="map"
      >
        {picked && <Marker lng={picked.lng} lat={picked.lat} color="#e53935" />}
      </MapsLibVNMap>

      <Search
        onPick={(item) => {
          setPicked(item);
          map?.flyTo([item.lng, item.lat], 16);
        }}
      />

      <View style={styles.toolbar}>
        <Pressable
          style={styles.btn}
          onPress={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        >
          <Text style={styles.btnText}>{theme === 'light' ? 'Tối' : 'Sáng'}</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => setLang(lang === 'vi' ? 'en' : 'vi')}>
          <Text style={styles.btnText}>{lang === 'vi' ? 'EN' : 'VI'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  search: { position: 'absolute', top: 56, left: 12, right: 12 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  list: { backgroundColor: '#fff', borderRadius: 8, marginTop: 6, maxHeight: 280 },
  row: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#eee' },
  name: { fontSize: 15, fontWeight: '600' },
  secondary: { fontSize: 12, color: '#666' },
  hint: { padding: 12, color: '#666' },
  toolbar: { position: 'absolute', right: 12, bottom: 48, gap: 8 },
  btn: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    elevation: 3,
  },
  btnText: { fontWeight: '600' },
});
