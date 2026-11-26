import { useEffect, useRef, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { ComponentRef, RefObject } from "react";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Eye, X } from "lucide-react-native";
import type { ReactNode } from "react";

type Props = {
  photos: string[];
  height: number;
  accentColor: string;
  surfaceColor: string;
  borderColor: string;
  textColor: string;
  previewOnly?: boolean;
  previewShape?: "rectangle" | "circle";
  renderOverlay?: (index: number) => ReactNode;
  placeholder?: ReactNode;
};

export function ProfilePhotoGallery({
  photos,
  height,
  accentColor,
  surfaceColor,
  borderColor,
  textColor,
  previewOnly = false,
  previewShape = "rectangle",
  renderOverlay,
  placeholder,
}: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [galleryWidth, setGalleryWidth] = useState(screenWidth);
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);
  const galleryScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const viewerScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const thumbnailScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const viewerThumbnailScroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const activeIndexRef = useRef(0);
  const viewerIndexRef = useRef(0);

  const selectGalleryPhoto = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, photos.length - 1));
    activeIndexRef.current = nextIndex;
    setActiveIndex(nextIndex);
    galleryScroll.current?.scrollTo({
      x: nextIndex * galleryWidth,
      animated: true,
    });
  };

  const selectViewerPhoto = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, photos.length - 1));
    viewerIndexRef.current = nextIndex;
    setViewerIndex(nextIndex);
    viewerScroll.current?.scrollTo({
      x: nextIndex * screenWidth,
      animated: true,
    });
  };

  const openViewer = () => {
    const index = previewOnly ? 0 : activeIndexRef.current;
    viewerIndexRef.current = index;
    setViewerIndex(index);
    setViewerVisible(true);
  };

  const closeViewer = () => {
    setViewerVisible(false);
    const index = previewOnly ? 0 : viewerIndexRef.current;
    activeIndexRef.current = index;
    setActiveIndex(index);
    galleryScroll.current?.scrollTo({
      x: index * galleryWidth,
      animated: false,
    });
  };

  useEffect(() => {
    activeIndexRef.current = 0;
    viewerIndexRef.current = 0;
    setActiveIndex(0);
    setViewerIndex(0);
    galleryScroll.current?.scrollTo({ x: 0, animated: false });
  }, [JSON.stringify(photos)]);

  useEffect(() => {
    if (photos.length < 2 || (previewOnly && !viewerVisible)) return;
    const timer = setInterval(() => {
      if (viewerVisible) {
        const nextIndex = (viewerIndexRef.current + 1) % photos.length;
        selectViewerPhoto(nextIndex);
      } else {
        const nextIndex = (activeIndexRef.current + 1) % photos.length;
        selectGalleryPhoto(nextIndex);
      }
    }, 4_500);
    return () => clearInterval(timer);
  }, [galleryWidth, photos.length, previewOnly, screenWidth, viewerVisible]);

  useEffect(() => {
    thumbnailScroll.current?.scrollTo({
      x: activeIndex * 62,
      animated: true,
    });
  }, [activeIndex]);

  useEffect(() => {
    viewerThumbnailScroll.current?.scrollTo({
      x: viewerIndex * 66,
      animated: true,
    });
  }, [viewerIndex]);

  const renderThumbnails = (
    selectedIndex: number,
    onSelect: (index: number) => void,
    ref: RefObject<ComponentRef<typeof ScrollView> | null>,
    viewer = false,
  ) =>
    photos.length > 1 ? (
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.thumbnailList}
        style={viewer ? styles.viewerThumbnails : undefined}
      >
        {photos.map((photo, index) => (
          <Pressable
            key={`${photo}-${index}`}
            accessibilityRole="button"
            accessibilityLabel={`Show photo ${index + 1} of ${photos.length}`}
            accessibilityState={{ selected: selectedIndex === index }}
            onPress={() => onSelect(index)}
            style={[
              styles.thumbnailButton,
              {
                width: viewer ? 58 : 54,
                height: viewer ? 70 : 66,
                borderColor:
                  selectedIndex === index ? accentColor : borderColor,
              },
              selectedIndex === index && styles.thumbnailButtonSelected,
            ]}
          >
            <Image
              source={{ uri: photo }}
              resizeMode="cover"
              style={styles.thumbnailImage}
            />
            {selectedIndex === index ? (
              <View
                pointerEvents="none"
                style={[
                  styles.thumbnailSelectedMark,
                  { backgroundColor: accentColor },
                ]}
              />
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    ) : null;

  const viewerThumbnails = renderThumbnails(
    viewerIndex,
    selectViewerPhoto,
    viewerThumbnailScroll,
    true,
  );

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.galleryFrame,
          previewShape === "circle" && styles.circleGalleryFrame,
          { height, backgroundColor: surfaceColor, borderColor },
        ]}
        onLayout={(event) => {
          const nextWidth = event.nativeEvent.layout.width;
          if (nextWidth > 0 && nextWidth !== galleryWidth) {
            setGalleryWidth(nextWidth);
          }
        }}
      >
        {photos.length ? (
          <ScrollView
            ref={galleryScroll}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            onMomentumScrollEnd={(event) => {
              const nextIndex = Math.max(
                0,
                Math.min(
                  photos.length - 1,
                  Math.round(event.nativeEvent.contentOffset.x / galleryWidth),
                ),
              );
              activeIndexRef.current = nextIndex;
              setActiveIndex(nextIndex);
            }}
            style={styles.pager}
          >
            {photos.map((photo, index) => (
              <View
                key={`${photo}-${index}`}
                style={[
                  styles.page,
                  previewShape === "circle" && styles.circlePage,
                  { width: galleryWidth, height },
                ]}
              >
                <View
                  style={
                    previewShape === "circle"
                      ? styles.circleImageFrame
                      : StyleSheet.absoluteFill
                  }
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Open photo ${index + 1} of ${photos.length}`}
                    onPress={openViewer}
                    style={StyleSheet.absoluteFill}
                  >
                    <Image
                      accessibilityLabel={`Profile photo ${index + 1}`}
                      source={{ uri: photo }}
                      resizeMode="cover"
                      style={[
                        styles.mainImage,
                        previewShape === "circle" && styles.circleImage,
                      ]}
                    />
                  </Pressable>

                  {previewShape === "circle" ? (
                    <View pointerEvents="none" style={styles.circleViewHint}>
                      <Eye color="#FFFFFF" size={16} />
                    </View>
                  ) : null}
                </View>
                {renderOverlay?.(index)}
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.empty}>
            {placeholder ?? (
              <Text style={[styles.emptyText, { color: textColor }]}>
                No photos added yet
              </Text>
            )}
          </View>
        )}
        {!previewOnly && photos.length > 1 ? (
          <View pointerEvents="none" style={styles.photoCount}>
            <Text style={styles.photoCountText}>
              {activeIndex + 1} / {photos.length}
            </Text>
          </View>
        ) : null}
      </View>
      {!previewOnly
        ? renderThumbnails(activeIndex, selectGalleryPhoto, thumbnailScroll)
        : null}
      <Modal
        visible={viewerVisible}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeViewer}
        onShow={() => {
          viewerScroll.current?.scrollTo({
            x: viewerIndex * screenWidth,
            animated: false,
          });
        }}
      >
        <View style={styles.viewer}>
          <ScrollView
            ref={viewerScroll}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            onMomentumScrollEnd={(event) => {
              const nextIndex = Math.max(
                0,
                Math.min(
                  photos.length - 1,
                  Math.round(event.nativeEvent.contentOffset.x / screenWidth),
                ),
              );
              viewerIndexRef.current = nextIndex;
              setViewerIndex(nextIndex);
            }}
            style={StyleSheet.absoluteFill}
          >
            {photos.map((photo, index) => (
              <View
                key={`${photo}-viewer-${index}`}
                style={[
                  styles.viewerPage,
                  { width: screenWidth, height: screenHeight },
                ]}
              >
                <Image
                  accessibilityLabel={`Profile photo ${index + 1}`}
                  source={{ uri: photo }}
                  resizeMode="cover"
                  style={styles.viewerImage}
                />
              </View>
            ))}
          </ScrollView>
          <SafeAreaView
            pointerEvents="box-none"
            style={styles.viewerHeaderOverlay}
            edges={["top"]}
          >
            <View style={styles.viewerHeader}>
              {photos.length > 1 ? (
                <Text style={styles.viewerCount}>
                  {viewerIndex + 1} / {photos.length}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close photo viewer"
                onPress={closeViewer}
                style={styles.viewerClose}
              >
                <X color="#FFFFFF" size={22} />
              </Pressable>
            </View>
          </SafeAreaView>
          {viewerThumbnails ? (
            <View
              pointerEvents="box-none"
              style={[
                styles.viewerThumbnailOverlay,
                { bottom: Math.max(insets.bottom, 8) },
              ]}
            >
              {viewerThumbnails}
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  galleryFrame: {
    width: "100%",
    overflow: "hidden",
    borderWidth: 1,
    borderRadius: 22,
  },
  circleGalleryFrame: {
    borderWidth: 0,
    borderRadius: 0,
  },
  pager: {
    flex: 1,
  },
  page: {
    overflow: "hidden",
  },
  circlePage: {
    alignItems: "center",
    justifyContent: "center",
  },
  circleImageFrame: {
    width: 124,
    height: 124,
    overflow: "hidden",
    borderRadius: 62,
  },
  mainImage: {
    ...StyleSheet.absoluteFill,
    width: "100%",
    height: "100%",
  },
  circleImage: {
    borderRadius: 62,
  },
  circleViewHint: {
    position: "absolute",
    right: 5,
    bottom: 5,
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    borderRadius: 15,
    backgroundColor: "rgba(20,13,16,0.72)",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 12,
    fontWeight: "600",
  },
  photoCount: {
    position: "absolute",
    top: 12,
    right: 12,
    minWidth: 48,
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    borderRadius: 14,
    backgroundColor: "rgba(20,13,16,0.62)",
  },
  photoCountText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },
  thumbnailList: {
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
  thumbnailButton: {
    overflow: "hidden",
    borderWidth: 2,
    borderRadius: 13,
  },
  thumbnailButtonSelected: {
    transform: [{ scale: 1.04 }],
  },
  thumbnailImage: {
    width: "100%",
    height: "100%",
  },
  thumbnailSelectedMark: {
    position: "absolute",
    right: 5,
    bottom: 5,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  viewer: {
    flex: 1,
    backgroundColor: "#080708",
  },
  viewerHeader: {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(8,7,8,0.28)",
  },
  viewerCount: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  viewerClose: {
    position: "absolute",
    top: 3,
    right: 14,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  viewerPager: {
    flex: 1,
  },
  viewerThumbnails: {
    backgroundColor: "rgba(8,7,8,0.48)",
  },
  viewerHeaderOverlay: {
    ...StyleSheet.absoluteFill,
  },
  viewerThumbnailOverlay: {
    position: "absolute",
    right: 0,
    left: 0,
    paddingVertical: 8,
    backgroundColor: "rgba(8,7,8,0.48)",
  },
  viewerPage: {
    alignItems: "center",
    justifyContent: "center",
  },
  viewerImage: {
    width: "100%",
    height: "100%",
  },
});
